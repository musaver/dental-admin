/**
 * FDI two-digit tooth notation (ISO 3950).
 *
 * The first digit is the quadrant, the second the tooth's position counting
 * outward from the midline:
 *
 *   Permanent   1 = upper right   2 = upper left
 *               4 = lower right   3 = lower left
 *   Primary     5 = upper right   6 = upper left
 *               8 = lower right   7 = lower left
 *
 * So 11 is the upper-right central incisor and 48 is the lower-right third
 * molar. Chosen over the US Universal system (1–32 / A–T) as the
 * international standard and the notation used in Pakistan.
 *
 * Pure module — no database or React import — so it can be unit tested.
 */

export type Dentition = 'permanent' | 'primary';

export interface Quadrant {
  code: number;
  label: string;
  /** Teeth ordered from the midline outward. */
  teeth: string[];
  vertical: 'upper' | 'lower';
  horizontal: 'right' | 'left';
}

function buildQuadrant(
  code: number,
  label: string,
  count: number,
  vertical: 'upper' | 'lower',
  horizontal: 'right' | 'left'
): Quadrant {
  return {
    code,
    label,
    teeth: Array.from({ length: count }, (_, i) => `${code}${i + 1}`),
    vertical,
    horizontal,
  };
}

/** 32 permanent teeth: 8 per quadrant, 11–18, 21–28, 31–38, 41–48. */
export const PERMANENT_QUADRANTS: Quadrant[] = [
  buildQuadrant(1, 'Upper right', 8, 'upper', 'right'),
  buildQuadrant(2, 'Upper left', 8, 'upper', 'left'),
  buildQuadrant(4, 'Lower right', 8, 'lower', 'right'),
  buildQuadrant(3, 'Lower left', 8, 'lower', 'left'),
];

/** 20 primary teeth: 5 per quadrant, 51–55, 61–65, 71–75, 81–85. */
export const PRIMARY_QUADRANTS: Quadrant[] = [
  buildQuadrant(5, 'Upper right', 5, 'upper', 'right'),
  buildQuadrant(6, 'Upper left', 5, 'upper', 'left'),
  buildQuadrant(8, 'Lower right', 5, 'lower', 'right'),
  buildQuadrant(7, 'Lower left', 5, 'lower', 'left'),
];

export function quadrantsFor(dentition: Dentition): Quadrant[] {
  return dentition === 'primary' ? PRIMARY_QUADRANTS : PERMANENT_QUADRANTS;
}

export function allTeeth(dentition: Dentition): string[] {
  return quadrantsFor(dentition).flatMap((q) => q.teeth);
}

export function isValidToothNumber(value: string): boolean {
  return allTeeth('permanent').includes(value) || allTeeth('primary').includes(value);
}

export function dentitionOf(toothNumber: string): Dentition | null {
  if (allTeeth('permanent').includes(toothNumber)) return 'permanent';
  if (allTeeth('primary').includes(toothNumber)) return 'primary';
  return null;
}

/** Anatomical name, for tooltips and printed treatment plans. */
const POSITION_NAMES = [
  'Central incisor',
  'Lateral incisor',
  'Canine',
  'First premolar',
  'Second premolar',
  'First molar',
  'Second molar',
  'Third molar',
] as const;

const PRIMARY_POSITION_NAMES = [
  'Central incisor',
  'Lateral incisor',
  'Canine',
  'First molar',
  'Second molar',
] as const;

export function toothName(toothNumber: string): string {
  const dentition = dentitionOf(toothNumber);
  if (!dentition) return toothNumber;

  const quadrant = quadrantsFor(dentition).find((q) => q.teeth.includes(toothNumber));
  if (!quadrant) return toothNumber;

  const position = Number(toothNumber[1]) - 1;
  const names = dentition === 'primary' ? PRIMARY_POSITION_NAMES : POSITION_NAMES;
  const name = names[position] ?? 'Tooth';

  return `${quadrant.label} ${name.toLowerCase()} (${toothNumber})`;
}

/* ── Surfaces ────────────────────────────────────────────────────────── */

/**
 * `tooth_conditions.surfaces` and `treatment_plan_items.surfaces` are packed
 * strings such as "MOD", not JSON arrays — varchar(10), so at most a handful
 * of letters. These helpers are the only place that encoding is interpreted.
 */
export const SURFACES = {
  M: 'Mesial',
  O: 'Occlusal',
  D: 'Distal',
  B: 'Buccal',
  L: 'Lingual',
  I: 'Incisal',
  F: 'Facial',
  P: 'Palatal',
} as const;

export type SurfaceCode = keyof typeof SURFACES;

const SURFACE_ORDER: SurfaceCode[] = ['M', 'O', 'I', 'D', 'B', 'F', 'L', 'P'];

/** "MOD" -> ['M','O','D']. Unknown letters are dropped rather than trusted. */
export function parseSurfaces(packed: string | null | undefined): SurfaceCode[] {
  if (!packed) return [];
  const seen = new Set<SurfaceCode>();
  for (const char of packed.toUpperCase()) {
    if (char in SURFACES) seen.add(char as SurfaceCode);
  }
  return SURFACE_ORDER.filter((s) => seen.has(s));
}

/** ['D','M','O'] -> "MOD", in a stable clinical order. */
export function packSurfaces(surfaces: readonly string[]): string | null {
  const valid = new Set(
    surfaces.map((s) => s.toUpperCase()).filter((s): s is SurfaceCode => s in SURFACES)
  );
  const packed = SURFACE_ORDER.filter((s) => valid.has(s)).join('');
  return packed || null;
}

/** "Mesial, Occlusal, Distal" — for a printed plan. */
export function describeSurfaces(packed: string | null | undefined): string {
  const parsed = parseSurfaces(packed);
  return parsed.map((s) => SURFACES[s]).join(', ');
}

/* ── Teeth lists ─────────────────────────────────────────────────────── */

/**
 * `treatment_plan_items.teeth`, `visit_procedures.teeth` and
 * `invoice_items.teeth` hold a CSV of tooth numbers — one line can cover
 * several teeth, which is what makes quantity meaningful for a per-tooth
 * procedure.
 */
export function parseTeeth(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((t) => t.trim())
    .filter((t) => isValidToothNumber(t));
}

export function packTeeth(teeth: readonly string[]): string | null {
  const unique = [...new Set(teeth.filter(isValidToothNumber))].sort();
  return unique.length ? unique.join(',') : null;
}

/** How many units a per-tooth procedure covers. Always at least 1. */
export function toothCount(csv: string | null | undefined): number {
  return Math.max(1, parseTeeth(csv).length);
}

/* ── Chart state ─────────────────────────────────────────────────────── */

export interface ChartedCondition {
  id: string;
  toothNumber: string;
  surfaces: string | null;
  conditionType: string;
  status: string;
  notes?: string | null;
}

/**
 * Group active conditions by tooth.
 *
 * tooth_conditions is event-sourced rather than a snapshot: the current chart
 * is every row with status 'active', and resolved history stays in the table.
 * One tooth can carry several conditions at once — a crown and an apical
 * lesion, say — so this maps to an array, never a single value.
 */
export function chartByTooth<T extends ChartedCondition>(
  conditions: readonly T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const condition of conditions) {
    const existing = map.get(condition.toothNumber);
    if (existing) existing.push(condition);
    else map.set(condition.toothNumber, [condition]);
  }
  return map;
}

/**
 * Which dentition to show by default.
 *
 * Under 6 is primary, 6–12 mixed (permanent is the more useful default while
 * adult teeth are erupting), over 12 permanent. Falls back to permanent when
 * the date of birth is unknown, which the schema allows.
 */
export function defaultDentition(age: number | null): Dentition {
  if (age === null) return 'permanent';
  return age < 6 ? 'primary' : 'permanent';
}
