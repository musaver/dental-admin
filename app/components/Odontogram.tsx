'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { ageFrom } from '@/lib/datetime';
import { humanize, TOOTH_CONDITION_TYPE, valuesOf } from '@/lib/enums';
import {
  chartByTooth,
  defaultDentition,
  packSurfaces,
  parseSurfaces,
  quadrantsFor,
  SURFACES,
  toothName,
  type ChartedCondition,
  type Dentition,
  type SurfaceCode,
} from '@/lib/odontogram';

/**
 * The dental chart.
 *
 * tooth_conditions is event-sourced, so what is drawn here is every row with
 * status 'active'; resolving a condition leaves the history intact rather than
 * deleting it.
 *
 * Laid out anatomically — upper arch above, lower below, patient's right on
 * the viewer's left, which is how a dentist looks at a mouth.
 */

/** Colour per condition type. Full literals: Tailwind cannot see interpolated names. */
const CONDITION_STYLES: Record<string, { chip: string; label: string }> = {
  caries: { chip: 'bg-red-500', label: 'Caries' },
  restoration: { chip: 'bg-blue-500', label: 'Restoration' },
  missing: { chip: 'bg-neutral-400', label: 'Missing' },
  crown: { chip: 'bg-amber-500', label: 'Crown' },
  bridge: { chip: 'bg-amber-600', label: 'Bridge' },
  implant: { chip: 'bg-violet-500', label: 'Implant' },
  rct: { chip: 'bg-pink-500', label: 'Root canal' },
  fracture: { chip: 'bg-orange-500', label: 'Fracture' },
  impacted: { chip: 'bg-cyan-600', label: 'Impacted' },
  mobility: { chip: 'bg-yellow-600', label: 'Mobility' },
  recession: { chip: 'bg-lime-600', label: 'Recession' },
  attrition: { chip: 'bg-stone-500', label: 'Attrition' },
  discolouration: { chip: 'bg-purple-400', label: 'Discolouration' },
  sealant: { chip: 'bg-teal-500', label: 'Sealant' },
  extraction: { chip: 'bg-neutral-700', label: 'For extraction' },
  veneer: { chip: 'bg-sky-400', label: 'Veneer' },
  other: { chip: 'bg-neutral-500', label: 'Other' },
};

const conditionStyle = (type: string) =>
  CONDITION_STYLES[type] ?? { chip: 'bg-neutral-500', label: humanize(type) };

export default function Odontogram({
  patientId,
  conditions,
  dateOfBirth,
  onChange,
}: {
  patientId: string;
  conditions: ChartedCondition[];
  dateOfBirth: Date | null;
  onChange: () => void;
}) {
  const age = ageFrom(dateOfBirth);
  const [dentition, setDentition] = useState<Dentition>(defaultDentition(age));
  const [selected, setSelected] = useState<string | null>(null);

  const byTooth = useMemo(() => chartByTooth(conditions), [conditions]);
  const quadrants = quadrantsFor(dentition);

  const upper = quadrants.filter((q) => q.vertical === 'upper');
  const lower = quadrants.filter((q) => q.vertical === 'lower');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Dental chart</CardTitle>
        <div className="flex gap-1 text-sm">
          {(['permanent', 'primary'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDentition(d)}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                dentition === d
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {d === 'permanent' ? 'Adult' : 'Primary'}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <div className="min-w-[560px] space-y-1">
            <ArchRow quadrants={upper} byTooth={byTooth} onSelect={setSelected} />
            <div className="border-t border-dashed" />
            <ArchRow quadrants={lower} byTooth={byTooth} onSelect={setSelected} />
          </div>
        </div>

        {/* Only show a key for conditions actually present on this chart. */}
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs border-t pt-3">
            {[...new Set(conditions.map((c) => c.conditionType))].map((type) => (
              <span key={type} className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${conditionStyle(type).chip}`} />
                {conditionStyle(type).label}
              </span>
            ))}
          </div>
        )}

        {conditions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing charted yet. Select a tooth to record a finding.
          </p>
        )}
      </CardContent>

      {selected && (
        <ToothDialog
          patientId={patientId}
          toothNumber={selected}
          existing={byTooth.get(selected) ?? []}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

function ArchRow({
  quadrants,
  byTooth,
  onSelect,
}: {
  quadrants: ReturnType<typeof quadrantsFor>;
  byTooth: Map<string, ChartedCondition[]>;
  onSelect: (tooth: string) => void;
}) {
  return (
    <div className="flex justify-center gap-4">
      {quadrants.map((quadrant) => (
        <div key={quadrant.code} className="flex gap-1">
          {/* The right quadrant is drawn outermost-first so the midline sits
              in the centre, matching how a mouth is viewed. */}
          {(quadrant.horizontal === 'right' ? [...quadrant.teeth].reverse() : quadrant.teeth).map(
            (tooth) => (
              <Tooth
                key={tooth}
                number={tooth}
                conditions={byTooth.get(tooth) ?? []}
                onSelect={onSelect}
              />
            )
          )}
        </div>
      ))}
    </div>
  );
}

function Tooth({
  number,
  conditions,
  onSelect,
}: {
  number: string;
  conditions: ChartedCondition[];
  onSelect: (tooth: string) => void;
}) {
  const primary = conditions[0];
  const isMissing = conditions.some((c) => c.conditionType === 'missing');

  return (
    <button
      type="button"
      onClick={() => onSelect(number)}
      title={`${toothName(number)}${
        conditions.length ? ` — ${conditions.map((c) => humanize(c.conditionType)).join(', ')}` : ''
      }`}
      aria-label={toothName(number)}
      className={`group flex w-8 flex-col items-center gap-0.5 rounded-md p-1 transition-colors hover:bg-muted ${
        isMissing ? 'opacity-40' : ''
      }`}
    >
      <span
        className={`flex h-8 w-7 items-center justify-center rounded border text-[10px] font-medium ${
          primary
            ? `${conditionStyle(primary.conditionType).chip} border-transparent text-white`
            : 'border-input bg-background text-muted-foreground'
        }`}
      >
        {conditions.length > 1 ? `+${conditions.length}` : primary ? '●' : ''}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">{number}</span>
    </button>
  );
}

function ToothDialog({
  patientId,
  toothNumber,
  existing,
  onClose,
  onSaved,
}: {
  patientId: string;
  toothNumber: string;
  existing: ChartedCondition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [conditionType, setConditionType] = useState<string>('caries');
  const [surfaces, setSurfaces] = useState<SurfaceCode[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleSurface = (surface: SurfaceCode) =>
    setSurfaces((current) =>
      current.includes(surface) ? current.filter((s) => s !== surface) : [...current, surface]
    );

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/patients/${patientId}/tooth-conditions`, {
        toothNumber,
        conditionType,
        surfaces: packSurfaces(surfaces),
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this finding.');
    } finally {
      setSaving(false);
    }
  }

  async function resolve(id: string) {
    setSaving(true);
    setError('');
    try {
      // Resolving marks the row, never deletes it — the chart is a history.
      await api.patch(`/api/patients/${patientId}/tooth-conditions/${id}`, {
        status: 'resolved',
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this finding.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{toothName(toothNumber)}</DialogTitle>
        </DialogHeader>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {existing.length > 0 && (
          <div className="space-y-2">
            <Label>Current findings</Label>
            <ul className="space-y-1.5">
              {existing.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-sm ${conditionStyle(c.conditionType).chip}`} />
                    {conditionStyle(c.conditionType).label}
                    {c.surfaces && (
                      <span className="font-mono text-xs text-muted-foreground">{c.surfaces}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => resolve(c.id)}
                  >
                    Mark resolved
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="conditionType">Add a finding</Label>
            <select
              id="conditionType"
              value={conditionType}
              onChange={(e) => setConditionType(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {valuesOf(TOOTH_CONDITION_TYPE).map((type) => (
                <option key={type} value={type}>
                  {conditionStyle(type).label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Surfaces</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SURFACES) as SurfaceCode[]).map((surface) => (
                <button
                  key={surface}
                  type="button"
                  onClick={() => toggleSurface(surface)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    surfaces.includes(surface)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input hover:bg-muted'
                  }`}
                  title={SURFACES[surface]}
                >
                  {surface}
                </button>
              ))}
            </div>
            {surfaces.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Recorded as <span className="font-mono">{packSurfaces(surfaces)}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="toothNotes">Notes</Label>
            <Textarea
              id="toothNotes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add finding'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Re-exported so callers do not need to reach into lib for the parse helper. */
export { parseSurfaces };
