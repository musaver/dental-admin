/**
 * The clinical record: visits, the work performed, the findings, the
 * odontogram and prescriptions.
 *
 * Two things here are load-bearing for the rest of the seed.
 *
 * 1. `visit_procedures.price` is PER UNIT. The table has no quantity column, so
 *    for a per-tooth procedure the tooth count carries the quantity and
 *    lib/invoices.ts multiplies the two. A three-tooth molar root canal is
 *    teeth='16,26,36', price=22000 — not 66000.
 *
 * 2. The odontogram is event-sourced. The current chart is every
 *    tooth_conditions row with status 'active'; work that settles a finding
 *    stamps resolvedByVisitId/resolvedAt on it instead of deleting it.
 */
import {
  ANTERIOR_TEETH,
  POSTERIOR_TEETH,
  PRIMARY_TEETH,
  at,
  chance,
  day,
  dt,
  int,
  nextClinicDay,
  packTeeth,
  pick,
  pickN,
  plusMinutes,
  shuffle,
  surfacesFor,
  uuid,
  weighted,
} from './context.mjs';

/* ── Targets ──────────────────────────────────────────────────────────── */

const STANDALONE_VISITS = 8;
/** Plan items closed by work actually performed. */
const PLAN_LINK_TARGET = 12;
const PRESCRIPTION_TARGET = 22;
const TOOTH_CONDITION_TARGET = 134;
/** How many chart rows may come out of the visit loop, leaving room for the
 *  background chart of untreated findings. */
const DERIVED_CONDITION_BUDGET = 58;
const CHART_PATIENTS = 30;

const NORMAL_BP = ['112/72', '118/76', '120/80', '122/78', '124/80', '126/82', '128/84', '130/84'];
const HIGH_BP = ['138/88', '142/90', '145/92', '148/94', '150/96', '156/98'];

/* ── Formulary ────────────────────────────────────────────────────────── */

const DRUGS = {
  augmentin: { drugName: 'Augmentin 625mg', dosage: '1 tab', frequency: 'TDS', durationDays: 5, instructions: 'After meals' },
  amoxicillin: { drugName: 'Amoxicillin 500mg', dosage: '1 cap', frequency: 'TDS', durationDays: 5, instructions: null },
  metronidazole: { drugName: 'Metronidazole 400mg', dosage: '1 tab', frequency: 'TDS', durationDays: 5, instructions: 'Avoid alcohol' },
  brufen: { drugName: 'Brufen 400mg', dosage: '1 tab', frequency: 'TDS', durationDays: 3, instructions: 'After food' },
  ponstan: { drugName: 'Ponstan Forte 500mg', dosage: '1 tab', frequency: 'SOS', durationDays: 3, instructions: null },
  panadol: { drugName: 'Panadol 500mg', dosage: '1-2 tabs', frequency: 'QID', durationDays: 3, instructions: null },
  chx: { drugName: 'Chlorhexidine mouthwash 0.2%', dosage: '10ml', frequency: 'BD', durationDays: 7, instructions: 'Rinse, do not swallow' },
  sensodyne: { drugName: 'Sensodyne toothpaste', dosage: null, frequency: 'BD', durationDays: 30, instructions: 'Do not rinse after brushing' },
};

const RX_NOTES = [
  'Complete the full course.',
  'Return sooner if the swelling increases.',
  'Stop and call the clinic if a rash appears.',
  null,
  null,
];

/* ── Teeth ────────────────────────────────────────────────────────────── */

/** Primary molars — where sealants and paediatric fillings actually go. */
const PRIMARY_MOLARS = PRIMARY_TEETH.filter((t) => Number(t[1]) >= 4);
const MOLARS = POSTERIOR_TEETH.filter((t) => Number(t[1]) >= 6);
const WISDOM_TEETH = ['18', '28', '38', '48'];
/** The teeth patients most often turn up already missing. */
const LOST_MOLARS = ['16', '26', '36', '46', '37', '47'];

function teethFor(kind, n) {
  const pool =
    kind === 'anterior' ? ANTERIOR_TEETH
    : kind === 'primary' ? PRIMARY_TEETH
    : kind === 'primary-molar' ? PRIMARY_MOLARS
    : POSTERIOR_TEETH;
  return pickN(pool, n).sort((a, b) => Number(a) - Number(b));
}

/** Root canal difficulty follows the tooth: incisor, premolar, molar. */
function rctCode(tooth) {
  const position = Number(tooth[1]);
  if (position <= 3) return 'END-01';
  if (position <= 5) return 'END-02';
  return 'END-03';
}

/* ── Story archetypes ─────────────────────────────────────────────────── */

/**
 * Each archetype supplies the patient's complaint, the dentist's notes and the
 * procedures that go with them, so a visit reads as one coherent episode
 * rather than a random bag of line items. `{t}` is filled with the tooth the
 * visit was about.
 */
const STORIES = {
  checkup: {
    complaints: [
      'Routine check-up, nothing hurting',
      'Here for the six-month check-up',
      'Wants a general check before travelling',
      'No complaints, wife told him to get checked',
    ],
    exam: [
      'Full mouth examination and charting. Oral hygiene fair, generalised plaque on lower anterior lingual. No active caries.',
      'Soft tissues normal. Mild marginal gingivitis lower anteriors. Occlusion stable, no cavitated lesions.',
      'Examination complete. Two early enamel lesions noted for review, nothing requiring restoration today.',
    ],
    treat: [
      'Examination and charting completed. Oral hygiene instruction given.',
      'Charting updated. Brushing technique demonstrated. No treatment required today.',
    ],
    follow: ['Brush twice daily, floss at night. Return in six months.'],
    dx: [
      { description: 'Sound dentition, no active caries', code: null, tooth: false },
      { description: 'Localised marginal gingivitis', code: 'K05.1', tooth: false },
    ],
    rx: [],
    build: () => {
      const specs = [{ code: 'CON-01', cat: 'diagnostic' }];
      if (chance(0.3)) specs.push({ code: 'XR-02', cat: 'diagnostic' });
      return specs;
    },
  },

  consult_plan: {
    complaints: [
      'Wants to know what all the teeth need',
      'New patient, wants a full assessment and a cost estimate',
      'Several teeth broken, wants advice on what to do first',
    ],
    exam: [
      'Multiple carious lesions charted. OPG shows no periapical pathology beyond {t}. Periodontal condition stable.',
      'Full charting done. Four teeth need restoration, one needs endodontic treatment. Discussed sequencing.',
    ],
    treat: [
      'Findings explained with the OPG on screen. Treatment plan written and costed, patient taking it home to decide.',
      'Treatment options and costs discussed. Plan prepared, no treatment carried out today.',
    ],
    follow: ['Call the clinic once you have decided; the quote holds for one month.'],
    dx: [{ description: 'Multiple carious lesions, treatment plan discussed', code: 'K02.1', tooth: false }],
    rx: [],
    build: () => {
      const specs = [{ code: 'CON-01', cat: 'diagnostic' }];
      if (chance(0.6)) specs.push({ code: 'XR-02', cat: 'diagnostic' });
      return specs;
    },
  },

  hygiene: {
    complaints: [
      'Bleeding gums when brushing',
      'Wants teeth cleaned before wedding',
      'Bad breath and bleeding gums for a few months',
      'Wants a scaling, last one was two years ago',
    ],
    exam: [
      'Generalised marginal gingivitis. Heavy calculus on lower anterior lingual and upper molar buccal. BOP in all sextants, no pocketing beyond 4mm.',
      'Moderate supragingival calculus, generalised stain from tea. Gingiva oedematous, bleeds on probing.',
      'Localised chronic periodontitis lower anteriors, 5mm pockets 31-41. Grade I mobility 31.',
    ],
    treat: [
      'Full mouth ultrasonic scaling and polishing. Oral hygiene instruction given, interdental brushes demonstrated.',
      'Scaling and polishing completed. Stain removed. Patient advised on brushing technique and interdental cleaning.',
    ],
    follow: [
      'Expect mild sensitivity for two or three days. Warm salt rinses twice daily.',
      'Sensitivity settles in a week. Return in six months for review.',
    ],
    dx: [
      { description: 'Chronic generalised gingivitis', code: 'K05.1', tooth: false },
      { description: 'Generalised supragingival calculus', code: 'K03.6', tooth: false },
      { description: 'Localised chronic periodontitis', code: 'K05.3', tooth: false },
    ],
    rx: ['chx'],
    build: () => {
      const specs = [{ code: 'SC-01', cat: 'preventive' }];
      if (chance(0.35)) specs.unshift({ code: 'CON-01', cat: 'diagnostic' });
      return specs;
    },
  },

  restorative: {
    complaints: [
      'Food gets stuck in the lower left back tooth',
      'Sensitivity to cold on the upper right',
      'Broken filling upper left',
      'Black spot on a back tooth, no pain',
      'Old filling came out while eating',
    ],
    exam: [
      'Occlusal caries {t} into dentine. Vitality positive, not tender to percussion. No periapical change on radiograph.',
      'Fractured amalgam {t} with recurrent caries at the margin. Pulp not exposed, cusps intact.',
      'Proximal caries {t}, radiographically into the outer third of dentine. Adjacent tooth sound.',
    ],
    treat: [
      'Caries excavated under LA. Composite placed incrementally, occlusion checked and polished.',
      'Old restoration removed, caries excavated. Liner placed, composite restoration built and finished. Contact point checked with floss.',
      'Restoration completed under rubber dam. Shade A2. Occlusion adjusted.',
    ],
    follow: [
      'Avoid hard food 24h. Analgesic as needed.',
      'Mild sensitivity for a few days is normal. Return if it lingers beyond a week.',
    ],
    dx: [
      { description: 'Deep occlusal caries', code: 'K02.1', tooth: true },
      { description: 'Caries of dentine', code: 'K02.1', tooth: true },
      { description: 'Fractured restoration with recurrent caries', code: 'K08.5', tooth: true },
    ],
    rx: ['analgesic'],
    build: () => {
      const n = weighted([[1, 6], [2, 3], [3, 1]]);
      const teeth = teethFor('posterior', n);
      const code = n === 1 && chance(0.45) ? 'RES-01' : 'RES-02';
      const specs = [
        { code, cat: 'restorative', teeth, surfaces: n === 1 ? surfacesFor(teeth[0]) : null },
      ];
      if (chance(0.35)) specs.push({ code: 'XR-01', cat: 'diagnostic', teeth: [teeth[0]] });
      return specs;
    },
  },

  endo: {
    complaints: [
      'Pain in lower right back tooth for 3 days',
      'Severe throbbing pain at night, cannot sleep',
      'Pain when drinking anything cold, stays for a long time',
      'Tooth has been hurting on and off for two weeks',
    ],
    exam: [
      'Deep distal caries {t} with pulpal involvement. Tender to percussion, lingering response to cold. Widened periodontal ligament space on radiograph.',
      'Necrotic pulp {t}, no response to cold, tender to percussion. Periapical radiolucency approximately 3mm.',
      'Caries into pulp {t}. Sinus tract buccally, traced to the apex on radiograph.',
    ],
    treat: [
      'Access cavity prepared under LA and rubber dam. Canals negotiated and worked to length. Calcium hydroxide dressing, temporary restoration.',
      'Canals cleaned, shaped and obturated with gutta-percha and sealer. Temporary restoration placed. Crown planned.',
      'Working length confirmed radiographically. Biomechanical preparation completed, intracanal medicament placed.',
    ],
    follow: [
      'Avoid chewing on this side until the crown is fitted. Analgesic as needed.',
      'Some tenderness for two or three days is expected. Return as booked for the next stage.',
    ],
    dx: [
      { description: 'Irreversible pulpitis', code: 'K04.0', tooth: true },
      { description: 'Pulp necrosis', code: 'K04.1', tooth: true },
      { description: 'Symptomatic apical periodontitis', code: 'K04.4', tooth: true },
    ],
    rx: ['antibiotic', 'analgesic'],
    build: () => {
      // A multi-tooth root canal is billed per tooth at one price, so all the
      // teeth in it have to be the same kind.
      const multi = chance(0.12);
      const teeth = multi
        ? pickN(MOLARS, 2).sort((a, b) => Number(a) - Number(b))
        : teethFor('posterior', 1);
      const specs = [{ code: multi ? 'END-03' : rctCode(teeth[0]), cat: 'endodontic', teeth }];
      if (chance(0.7)) specs.push({ code: 'XR-01', cat: 'diagnostic', teeth: [teeth[0]] });
      return specs;
    },
  },

  extraction: {
    complaints: [
      'Wants the broken tooth taken out',
      'Wisdom tooth pain on the lower right',
      'Tooth is loose and painful when chewing',
      'Wants the painful tooth removed today, does not want a root canal',
    ],
    exam: [
      'Grossly carious {t}, unrestorable. No facial swelling, no trismus.',
      'Partially erupted {t}, operculum inflamed, food packing. Mesioangular impaction on radiograph.',
      'Retained root {t}. Grade III mobility, no acute infection.',
    ],
    treat: [
      'Extraction under LA. Socket curetted and irrigated, haemostasis achieved with pressure. Post-operative instructions given verbally and in writing.',
      'Surgical extraction under LA, buccal flap raised, bone guttering and sectioning. Socket irrigated, 3-0 silk suture placed.',
      'Forceps extraction, tooth delivered intact. Socket compressed, gauze pack given.',
    ],
    follow: [
      'Bite on the gauze for 30 minutes. No rinsing, spitting or smoking for 24h. Soft, cool diet. Analgesic as needed.',
      'Do not disturb the socket. Warm salt rinses from tomorrow. Sutures out in one week.',
    ],
    dx: [
      { description: 'Unrestorable grossly carious tooth', code: 'K02.1', tooth: true },
      { description: 'Impacted mesioangular {t}', code: 'K01.1', tooth: true },
      { description: 'Chronic pericoronitis', code: 'K05.2', tooth: true },
    ],
    rx: ['antibiotic', 'analgesic'],
    build: () => {
      const tooth = chance(0.4) ? pick(WISDOM_TEETH) : pick(POSTERIOR_TEETH);
      const specs = [
        { code: tooth.endsWith('8') ? 'SUR-03' : 'SUR-01', cat: 'surgical', teeth: [tooth] },
      ];
      if (chance(0.5)) specs.push({ code: 'XR-01', cat: 'diagnostic', teeth: [tooth] });
      return specs;
    },
  },

  crown: {
    complaints: [
      'Crown came off while eating',
      'Wants a cap on the root canal treated tooth',
      'Tooth chipped, looks bad when smiling',
      'Here for the crown fitting',
    ],
    exam: [
      'Root treated {t}, coronal seal intact, adequate remaining tooth structure for full coverage.',
      'Fractured mesiolingual cusp {t}. No pulpal symptoms, vitality positive.',
      'Existing crown {t} debonded, margins carious. Underlying core sound after caries removal.',
    ],
    treat: [
      'Tooth prepared for full coverage crown. Cord packed, impression taken in putty and light body. Shade A2. Temporary crown cemented.',
      'Crown tried in, contacts and occlusion adjusted, cemented with glass ionomer. Excess cement removed and margins checked.',
      'Core build-up placed, preparation refined, impression and bite registration taken.',
    ],
    follow: [
      'Avoid sticky food on the temporary. Return in one week for the fit.',
      'Chew normally. Floss carefully around the margin rather than pulling up.',
    ],
    dx: [
      { description: 'Post-endodontic tooth requiring cuspal coverage', code: null, tooth: true },
      { description: 'Fractured cusp', code: 'K08.8', tooth: true },
    ],
    rx: [],
    build: () => {
      const teeth = teethFor('posterior', chance(0.2) ? 2 : 1);
      return [{ code: chance(0.5) ? 'PRO-01' : 'PRO-02', cat: 'prosthodontic', teeth }];
    },
  },

  implant: {
    complaints: [
      'Wants a permanent replacement for the missing back tooth',
      'Does not want a denture, asking about implants',
    ],
    exam: [
      'Edentulous {t} site, ridge healed and knife-edge free. OPG shows 12mm bone height above the canal.',
      'Missing {t} for over a year. Adjacent teeth sound and unrestored, so a bridge is not indicated.',
    ],
    treat: [
      'Implant placed under LA with copious irrigation. Primary stability good at 35Ncm. Cover screw placed, flap closed with 3-0 silk.',
      'Osteotomy prepared to depth under guided irrigation. Fixture seated, healing abutment placed.',
    ],
    follow: [
      'Soft diet for one week. Do not brush the surgical site, use the mouthwash instead. Sutures out in 10 days.',
    ],
    dx: [{ description: 'Edentulous span {t}, adequate ridge for implant', code: 'K08.1', tooth: true }],
    rx: ['antibiotic', 'analgesic', 'chx'],
    build: () => {
      const teeth = teethFor('posterior', 1);
      // IMP-01 is filed under `surgical` in the procedures table, not
      // prosthodontic. The fallback category has to match the real one, or a
      // renamed code would substitute a crown for a fixture.
      const specs = [{ code: 'IMP-01', cat: 'surgical', teeth }];
      if (chance(0.6)) specs.push({ code: 'XR-02', cat: 'diagnostic' });
      return specs;
    },
  },

  ortho: {
    complaints: [
      'Here for braces tightening',
      'Wants to straighten the crowded front teeth',
      'A bracket came off the lower left',
      'Wire is poking the cheek',
    ],
    exam: [
      'Class I molar relation, upper anterior crowding 5mm. Oral hygiene adequate around the brackets, mild demineralisation on 12.',
      'Alignment progressing. Lower arch levelled, upper canines rotating into position. No root resorption on the review radiograph.',
      'Debonded bracket on 35. Rest of the appliance intact, wire ligated.',
    ],
    treat: [
      'Archwire changed to 0.018 NiTi. Elastics demonstrated to the patient.',
      'Bracket rebonded, wire re-engaged and tied. Distal end cut and tucked.',
      'Bonding of upper and lower fixed appliance completed, 0.014 NiTi placed. Instructions and wax given.',
    ],
    follow: [
      'Wear the elastics full time except when eating. Review in four weeks.',
      'Use the wax if anything rubs. Avoid hard and sticky food.',
    ],
    dx: [{ description: 'Class I malocclusion with anterior crowding', code: 'K07.3', tooth: false }],
    rx: [],
    build: () => {
      if (chance(0.2)) return [{ code: 'ORT-02', cat: 'orthodontic' }];
      return [{ code: 'ORT-03', cat: 'orthodontic' }];
    },
  },

  cosmetic: {
    complaints: [
      'Wants whiter teeth before the wedding',
      'Front teeth look yellow in photographs',
      'Wants to know about whitening, drinks a lot of tea',
    ],
    exam: [
      'Generalised extrinsic staining, shade A3.5. No active caries, gingiva healthy, no exposed dentine.',
      'Tea and paan staining on the labial surfaces. Enamel intact, suitable for in-office whitening.',
    ],
    treat: [
      'Gingival barrier placed, whitening gel applied for three cycles. Final shade A1. Desensitising gel applied afterwards.',
      'Scaling done first to remove stain, then two whitening cycles. Shade improved by four tabs.',
    ],
    follow: [
      'Avoid tea, coffee, cola and paan for 48h. Some sensitivity for a day or two is normal.',
    ],
    dx: [{ description: 'Generalised extrinsic staining', code: 'K03.6', tooth: false }],
    rx: ['sensodyne'],
    build: () => {
      const specs = [{ code: 'COS-01', cat: 'cosmetic' }];
      if (chance(0.4)) specs.unshift({ code: 'SC-01', cat: 'preventive' });
      return specs;
    },
  },

  emergency: {
    complaints: [
      'Swelling on the left cheek since yesterday',
      'Face swollen, cannot open the mouth properly',
      'Severe pain since last night, painkillers are not working',
      'Tooth broke while eating, sharp edge cutting the tongue',
    ],
    exam: [
      'Diffuse buccal swelling adjacent to {t}. Grossly carious, tender to percussion, Grade II mobility. Pus expressed on pressure.',
      'Facial swelling left submandibular region, temperature 38.1C, mouth opening 30mm. {t} non-vital and tender.',
      'Fractured crown {t} with pulp exposure, bleeding on probing the exposure. Sharp enamel edge traumatising the tongue.',
    ],
    treat: [
      'Drainage obtained through the tooth. Occlusion relieved, tooth left open. Patient advised to return for definitive treatment.',
      'Incision and drainage under LA, pus drained. Irrigation with saline. Definitive treatment deferred until the acute phase settles.',
      'Sharp edges smoothed and a sedative dressing placed. Definitive treatment planned once the pain settles.',
    ],
    follow: [
      'Warm salt rinses every four hours. Return in three days, or sooner if the swelling increases or breathing feels tight.',
      'Soft diet, plenty of fluids. Return as booked for the definitive treatment.',
    ],
    dx: [
      { description: 'Acute apical abscess', code: 'K04.7', tooth: true },
      { description: 'Localised buccal space infection', code: 'K12.2', tooth: true },
      { description: 'Complicated crown fracture with pulp exposure', code: 'S02.5', tooth: true },
    ],
    rx: ['antibiotic', 'analgesic'],
    build: () => {
      const teeth = teethFor('posterior', 1);
      const specs = [{ code: 'CON-01', cat: 'diagnostic' }];
      if (chance(0.8)) specs.push({ code: 'XR-01', cat: 'diagnostic', teeth });
      return specs;
    },
  },

  pedo_restore: {
    complaints: [
      'Child complains of pain while eating sweets',
      'Mother noticed a black spot on a back tooth',
      'Child crying at night with toothache',
      'Child refuses to chew on the right side',
    ],
    exam: [
      'Occlusal caries {t} into dentine. Cooperative child, Frankl 3. No swelling or sinus.',
      'Two carious primary molars, {t} the deeper. Pulp not exposed on radiographic assessment.',
    ],
    treat: [
      'Caries removed under LA with topical first. Composite restoration placed. Tell-show-do used throughout, child cooperative.',
      'Restoration completed with rubber dam. Child managed well, praised and given a sticker.',
    ],
    follow: [
      'Avoid hard food 24h. Supervise brushing twice daily and cut down on sweet drinks between meals.',
    ],
    dx: [{ description: 'Caries of dentine, primary molar', code: 'K02.1', tooth: true }],
    rx: ['analgesic'],
    build: () => {
      const n = chance(0.35) ? 2 : 1;
      const teeth = teethFor('primary-molar', n);
      return [
        { code: 'PED-01', cat: 'pediatric', teeth, surfaces: n === 1 ? surfacesFor(teeth[0]) : null },
      ];
    },
  },

  pedo_preventive: {
    complaints: [
      'Routine check-up for the child',
      'School dental check advised a visit',
      'Mother wants the new back teeth protected',
    ],
    exam: [
      'Mixed dentition, age appropriate. Deep pits and fissures on the erupting first permanent molars. No caries.',
      'No caries detected. Plaque on the lower anteriors, brushing supervised by the mother.',
    ],
    treat: [
      'Fluoride varnish applied to all quadrants. Diet and brushing advice given to the mother.',
      'Fissure sealants placed and checked with the explorer. Fluoride varnish applied.',
    ],
    follow: ['Nothing to eat or drink for 30 minutes. Review in six months.'],
    dx: [{ description: 'Deep pits and fissures, moderate caries risk', code: null, tooth: false }],
    rx: [],
    build: () => {
      const specs = [];
      if (chance(0.5)) specs.push({ code: 'CON-01', cat: 'diagnostic' });
      if (chance(0.6)) specs.push({ code: 'SEA-01', cat: 'preventive', teeth: teethFor('primary-molar', 2) });
      specs.push({ code: 'FL-01', cat: 'preventive' });
      return specs;
    },
  },
};

const PROCEDURE_NOTES = {
  restorative: ['Shade A2.', 'Rubber dam isolation.', 'Liner placed over the deepest point.', null, null],
  endodontic: ['Three canals located.', 'Working length confirmed radiographically.', 'Calcium hydroxide dressing.', null],
  surgical: ['LA: 2% lignocaine with adrenaline, 1.8ml.', 'Tooth delivered intact.', '3-0 silk suture placed.', null],
  prosthodontic: ['Shade A2.', 'Temporary cemented.', 'Occlusion adjusted at fit.', null],
  periodontic: ['Ultrasonic and hand instrumentation.', null, null],
  pediatric: ['Topical before LA, child cooperative.', null],
  default: [null, null, null],
};

/** The category a story belongs to, so a plan-linked procedure gets notes that
 *  describe the work that was actually done. */
const CATEGORY_STORY = {
  restorative: 'restorative',
  endodontic: 'endo',
  surgical: 'extraction',
  prosthodontic: 'crown',
  periodontic: 'hygiene',
  cosmetic: 'cosmetic',
  orthodontic: 'ortho',
  preventive: 'checkup',
  diagnostic: 'checkup',
  pediatric: 'pedo_restore',
};

/** Chart entry a pending plan item is the answer to. */
const CATEGORY_CONDITION = {
  restorative: 'caries',
  endodontic: 'caries',
  pediatric: 'caries',
  surgical: 'extraction',
  prosthodontic: 'crown',
  cosmetic: 'veneer',
  preventive: 'sealant',
  periodontic: 'recession',
  orthodontic: 'other',
  diagnostic: 'other',
};

const CONDITION_NOTES = {
  caries: ['Cavitated, into dentine.', 'Proximal, radiographic only.', 'Recurrent at the margin of an old restoration.', null],
  fracture: ['Enamel crack, asymptomatic.', 'Cusp fractured, no pulp exposure.', null],
  mobility: ['Grade I mobility.', 'Grade II mobility, 5mm pocket.'],
  recession: ['2mm buccal recession, sensitive to cold.', 'Miller Class I recession.', null],
  attrition: ['Wear facet, patient grinds at night.', 'Incisal wear into dentine.', null],
  missing: ['Extracted before registering at this clinic.', 'Lost years ago, no replacement.', null],
  crown: ['PFM crown, margins sound.', 'Zirconia crown, occlusion checked.', null],
  rct: ['Root treated, coronal seal intact.', 'Root filling adequate to length.', null],
  implant: ['Implant with screw-retained crown, stable.', null],
  restoration: ['Composite restoration, sound.', 'Amalgam, margins acceptable.', null],
  sealant: ['Fissure sealant intact.', null],
  discolouration: ['Non-vital discolouration.', 'Tetracycline banding.', null],
  impacted: ['Mesioangular impaction, asymptomatic.', 'Vertical impaction, review annually.'],
  extraction: ['Unrestorable, planned for extraction.', null],
  veneer: ['Planned for a veneer.', null],
  other: [null],
};

/**
 * The chart behind the visits: what is wrong today and what was done before
 * this clinic ever saw the patient. `teeth` names the pool the tooth comes
 * from; 'gaps' and 'wisdom' are the teeth that actually go missing or stay
 * buried.
 */
const ADULT_FINDINGS = [
  { weight: 8, conditionType: 'caries', status: 'active', teeth: 'posterior', surfaces: true },
  { weight: 3, conditionType: 'caries', status: 'watch', teeth: 'posterior', note: 'Early enamel lesion, review in six months.' },
  { weight: 5, conditionType: 'restoration', status: 'active', teeth: 'posterior', surfaces: true },
  { weight: 2, conditionType: 'fracture', status: 'active', teeth: 'posterior' },
  { weight: 2, conditionType: 'mobility', status: 'active', teeth: 'posterior' },
  { weight: 2, conditionType: 'recession', status: 'active', teeth: 'anterior' },
  { weight: 2, conditionType: 'attrition', status: 'watch', teeth: 'anterior' },
  { weight: 1, conditionType: 'discolouration', status: 'active', teeth: 'anterior' },
  { weight: 2, conditionType: 'missing', status: 'active', teeth: 'gaps' },
  { weight: 2, conditionType: 'impacted', status: 'watch', teeth: 'wisdom' },
  { weight: 2, conditionType: 'crown', status: 'active', teeth: 'posterior' },
  { weight: 2, conditionType: 'rct', status: 'active', teeth: 'posterior' },
  { weight: 1, conditionType: 'implant', status: 'active', teeth: 'posterior' },
];

const CHILD_FINDINGS = [
  { weight: 4, conditionType: 'caries', status: 'active', teeth: 'primary', surfaces: true },
  { weight: 2, conditionType: 'caries', status: 'watch', teeth: 'primary', note: 'White spot lesion, remineralisation advised.' },
  { weight: 2, conditionType: 'restoration', status: 'active', teeth: 'primary', surfaces: true },
  { weight: 2, conditionType: 'sealant', status: 'active', teeth: 'primary-molar' },
  { weight: 1, conditionType: 'missing', status: 'active', teeth: 'primary', note: 'Exfoliated early after caries.' },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */

function fill(text, tooth) {
  return text.replace(/\{t\}/g, tooth ?? 'the tooth');
}

/**
 * Hypertension is recorded by the patients module as a patient_conditions row,
 * not as a field on the patient, so look in both places rather than assuming.
 */
function findHypertensive(world, rows) {
  const ids = new Set();
  const looksHypertensive = (label) => /hypertens|blood pressure/i.test(String(label ?? ''));

  for (const patient of world.patients ?? []) {
    if (patient.isHypertensive || patient.hypertensive) ids.add(patient.id);
    const list = Array.isArray(patient.conditions) ? patient.conditions : [];
    for (const entry of list) {
      const label = typeof entry === 'string' ? entry : entry?.name ?? entry?.label;
      if (looksHypertensive(label)) ids.add(patient.id);
    }
  }

  const charted = typeof rows.all === 'function' ? rows.all().get('patient_conditions') : null;
  for (const condition of charted ?? []) {
    if (looksHypertensive(condition.name) && condition.status !== 'resolved') {
      ids.add(condition.patientId);
    }
  }
  return ids;
}

/* ── Build ────────────────────────────────────────────────────────────── */

export default function build(world, rows) {
  const patients = world.patients ?? [];
  const allProcedures = world.procedures ?? [];
  if (!patients.length || !allProcedures.length) return;

  const patientById = new Map(patients.map((p) => [p.id, p]));
  const procById = new Map(allProcedures.map((p) => [p.id, p]));
  const procByCode = new Map(allProcedures.map((p) => [p.code, p]));
  const hypertensive = findHypertensive(world, rows);

  /** Resolve by code, falling back to the category so a renamed code cannot
   *  drop a procedure out of the seed entirely. */
  function procedureFor(code, category) {
    const exact = procByCode.get(code);
    if (exact) return exact;
    const sameCategory = allProcedures.filter((p) => p.category === category);
    return sameCategory[0] ?? allProcedures[0];
  }

  const clinicalStaff = (world.staff ?? []).filter((s) => s.isClinical);
  const staffPool = clinicalStaff.length ? clinicalStaff : world.staff ?? [];

  function dentistFor(branchId) {
    const local = staffPool.filter((s) => !s.branchId || s.branchId === branchId);
    return (local.length ? pick(local) : pick(staffPool))?.id ?? null;
  }

  /* ── Plan items waiting to be closed by real work ───────────────────── */

  const itemsById = new Map();
  const pendingByPatient = new Map();
  for (const plan of world.plans ?? []) {
    for (const item of plan.items ?? []) {
      itemsById.set(item.id, { item, plan });
      if (item.status === 'pending') {
        if (!pendingByPatient.has(plan.patientId)) pendingByPatient.set(plan.patientId, []);
        pendingByPatient.get(plan.patientId).push({ item, plan });
      }
    }
  }

  const linkable = [];
  for (const { item, plan } of itemsById.values()) {
    const planStarted = plan.status === 'in_progress' || plan.status === 'completed';
    if (planStarted && item.status === 'completed' && !item.visitProcedureId) {
      linkable.push({ item, plan });
    }
  }
  const linkableById = new Map(linkable.map((entry) => [entry.item.id, entry]));

  /* ── Visit skeletons ────────────────────────────────────────────────── */

  const skeletons = [];

  for (const appointment of world.appointments ?? []) {
    if (appointment.status !== 'completed' && appointment.status !== 'in_progress') continue;
    const startAt =
      appointment.startAt instanceof Date ? appointment.startAt : new Date(appointment.startAt);
    const endAt =
      appointment.endAt instanceof Date ? appointment.endAt
      : appointment.endAt ? new Date(appointment.endAt)
      : plusMinutes(startAt, 30);
    skeletons.push({
      patientId: appointment.patientId,
      branchId: appointment.branchId,
      dentistId: appointment.dentistId ?? dentistFor(appointment.branchId),
      appointmentId: appointment.id,
      appointmentType: appointment.type ?? 'procedure',
      planItemId: appointment.treatmentPlanItemId ?? null,
      startAt,
      endAt,
      status: appointment.status,
      forced: [],
    });
  }

  // Walk-ins: clinical records with nothing on the diary behind them.
  const walkInPatients = pickN(patients, Math.min(STANDALONE_VISITS, patients.length));
  walkInPatients.forEach((patient, index) => {
    const isToday = index === walkInPatients.length - 1;
    const startAt = isToday
      ? at(day(0), 11, 30)
      : at(nextClinicDay(day(-int(3, 80))), int(9, 17), pick([0, 15, 30, 45]));
    skeletons.push({
      patientId: patient.id,
      branchId: patient.branchId,
      dentistId: dentistFor(patient.branchId),
      appointmentId: null,
      appointmentType: 'emergency',
      planItemId: null,
      startAt,
      endAt: plusMinutes(startAt, 30),
      status: isToday ? 'in_progress' : 'completed',
      forced: [],
    });
  });

  if (!skeletons.length) return;

  /* ── Assign completed plan items to the visits that delivered them ──── */

  let linked = 0;
  const completedSkeletons = skeletons.filter((s) => s.status === 'completed');

  // An appointment booked against a plan item is the honest place to close it.
  for (const skeleton of completedSkeletons) {
    if (linked >= PLAN_LINK_TARGET || !skeleton.planItemId) continue;
    const entry = linkableById.get(skeleton.planItemId);
    if (!entry || entry.assigned || entry.plan.patientId !== skeleton.patientId) continue;
    entry.assigned = true;
    skeleton.forced.push(entry.item);
    linked += 1;
  }

  // Top up from anything else the same patient had done.
  for (const entry of linkable) {
    if (linked >= PLAN_LINK_TARGET) break;
    if (entry.assigned) continue;
    const host = completedSkeletons.find(
      (s) => s.patientId === entry.plan.patientId && s.forced.length < 2
    );
    if (!host) continue;
    entry.assigned = true;
    host.forced.push(entry.item);
    linked += 1;
  }

  /* ── The odontogram ─────────────────────────────────────────────────── */

  const activeKeys = new Set();
  const goneTeeth = new Map();

  function addCondition(spec) {
    const key = `${spec.patientId}|${spec.toothNumber}|${spec.conditionType}`;
    const status = spec.status ?? 'active';
    if (status === 'active') {
      if (activeKeys.has(key)) return null;
      activeKeys.add(key);
    }
    if (spec.conditionType === 'missing' || spec.conditionType === 'extraction') {
      if (!goneTeeth.has(spec.patientId)) goneTeeth.set(spec.patientId, new Set());
      goneTeeth.get(spec.patientId).add(spec.toothNumber);
    }
    return rows.push('tooth_conditions', {
      id: uuid(),
      patientId: spec.patientId,
      toothNumber: spec.toothNumber,
      surfaces: spec.surfaces ?? null,
      conditionType: spec.conditionType,
      status,
      notes: spec.notes ?? null,
      visitId: spec.visitId ?? null,
      diagnosisId: spec.diagnosisId ?? null,
      treatmentPlanItemId: spec.treatmentPlanItemId ?? null,
      resolvedByVisitId: spec.resolvedByVisitId ?? null,
      resolvedAt: spec.resolvedAt ? dt(spec.resolvedAt) : null,
      recordedBy: spec.recordedBy,
      recordedAt: dt(spec.recordedAt),
    });
  }

  /** A tooth the patient still has, or null after a few honest attempts. */
  function freeTooth(patientId, kind) {
    const gone = goneTeeth.get(patientId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const tooth = teethFor(kind, 1)[0];
      if (!gone || !gone.has(tooth)) return tooth;
    }
    return null;
  }

  let derivedConditions = 0;

  /* ── Visits ─────────────────────────────────────────────────────────── */

  const visits = world.visits ?? (world.visits = []);
  const rxCandidates = [];
  let partialBudget = 4;
  let cancelBudget = 2;

  for (const skeleton of skeletons) {
    const patient = patientById.get(skeleton.patientId);
    const isChild = Boolean(patient?.isChild);
    const inProgress = skeleton.status === 'in_progress';

    /* Which story this visit tells. */
    let storyKey;
    if (skeleton.forced.length) {
      const forcedProc = procById.get(skeleton.forced[0].procedureId);
      // CATEGORY_STORY is keyed by category, and an implant shares 'surgical'
      // with the extractions — without this the notes would describe taking a
      // tooth out on the visit that placed the fixture.
      storyKey =
        forcedProc?.code === 'IMP-01' ? 'implant'
        : CATEGORY_STORY[forcedProc?.category] ?? 'restorative';
      if (isChild) storyKey = 'pedo_restore';
    } else if (isChild) {
      storyKey = weighted([['pedo_restore', 3], ['pedo_preventive', 3], ['checkup', 1]]);
    } else {
      switch (skeleton.appointmentType) {
        case 'consultation':
          storyKey = weighted([['consult_plan', 3], ['checkup', 3], ['hygiene', 1]]);
          break;
        case 'checkup':
          storyKey = weighted([['checkup', 4], ['hygiene', 3], ['restorative', 1]]);
          break;
        case 'emergency':
          storyKey = weighted([['emergency', 3], ['endo', 3], ['extraction', 3]]);
          break;
        case 'follow_up':
          storyKey = weighted([['crown', 3], ['endo', 2], ['ortho', 2], ['restorative', 2], ['hygiene', 1]]);
          break;
        default:
          storyKey = weighted([
            ['restorative', 5], ['endo', 3], ['hygiene', 3], ['extraction', 2],
            ['crown', 2], ['ortho', 2], ['cosmetic', 1], ['implant', 1],
          ]);
      }
    }
    const story = STORIES[storyKey];

    /* Procedures. Forced plan work first, then whatever the story adds. */
    const specs = [];
    for (const item of skeleton.forced) {
      specs.push({ item, code: null, cat: null });
    }
    // A visit still under way may not have anything recorded against it yet.
    if (!inProgress || chance(0.6)) {
      const limit = inProgress ? 1 : 3;
      for (const spec of story.build()) {
        if (specs.length >= limit) break;
        specs.push(spec);
      }
    }

    const performed = [];
    for (const spec of specs) {
      const item = spec.item ?? null;
      const procedure = item
        ? procById.get(item.procedureId) ?? procedureFor('CON-01', 'diagnostic')
        : procedureFor(spec.code, spec.cat);
      if (!procedure) continue;

      let teeth = null;
      if (item && item.teeth) teeth = String(item.teeth).split(',').filter(Boolean);
      else if (spec.teeth) teeth = spec.teeth;

      let surfaces = item ? item.surfaces ?? null : spec.surfaces ?? null;

      // The procedure definition, not the story, decides whether teeth apply:
      // a per-tooth procedure with no teeth would bill as a single unit.
      if (procedure.isPerTooth) {
        if (!teeth || !teeth.length) teeth = teethFor(isChild ? 'primary-molar' : 'posterior', 1);
        if (teeth.length > 1) surfaces = null;
      } else {
        teeth = null;
        surfaces = null;
      }

      let status = 'completed';
      if (inProgress) status = 'partial';
      else if (!item && procedure.category === 'endodontic' && partialBudget > 0 && chance(0.35)) {
        status = 'partial';
        partialBudget -= 1;
      } else if (!item && cancelBudget > 0 && chance(0.02)) {
        status = 'cancelled';
        cancelBudget -= 1;
      }

      performed.push({
        item,
        procedure,
        teeth,
        surfaces,
        status,
        price: item ? item.unitPrice ?? procedure.defaultPrice : procedure.defaultPrice,
      });
    }

    /* The tooth the visit was about, for the note text. */
    const primaryTooth = performed.find((p) => p.teeth && p.teeth.length)?.teeth[0] ?? null;

    const isProcedureVisit = performed.some(
      (p) => p.procedure.category !== 'diagnostic' && p.status !== 'cancelled'
    );
    const bloodPressure =
      hypertensive.has(skeleton.patientId) ? pick(HIGH_BP)
      : chance(0.33) ? pick(NORMAL_BP)
      : null;

    const visitId = uuid();
    const visitRow = rows.push('visits', {
      id: visitId,
      patientId: skeleton.patientId,
      branchId: skeleton.branchId,
      appointmentId: skeleton.appointmentId,
      dentistId: skeleton.dentistId,
      visitDate: dt(skeleton.startAt),
      chiefComplaint: pick(story.complaints),
      examinationNotes: fill(pick(story.exam), primaryTooth),
      treatmentNotes: inProgress
        ? 'Treatment under way; notes to be completed at the end of the appointment.'
        : fill(pick(story.treat), primaryTooth),
      bloodPressure,
      followUpInstructions:
        !inProgress && isProcedureVisit && story.follow.length ? pick(story.follow) : null,
      status: skeleton.status,
      createdAt: dt(skeleton.startAt),
      updatedAt: dt(inProgress ? skeleton.startAt : skeleton.endAt),
    });

    /* Procedure rows, and both sides of the plan-item pointer pair. */
    const worldProcedures = [];
    for (const entry of performed) {
      const vpId = uuid();
      const teethCsv = entry.teeth && entry.teeth.length ? packTeeth(entry.teeth) : null;
      const vpRow = rows.push('visit_procedures', {
        id: vpId,
        visitId,
        patientId: skeleton.patientId,
        procedureId: entry.procedure.id,
        treatmentPlanItemId: entry.item ? entry.item.id : null,
        teeth: teethCsv,
        surfaces: entry.surfaces,
        performedBy: skeleton.dentistId,
        status: entry.status,
        price: entry.price,
        notes: pick(PROCEDURE_NOTES[entry.procedure.category] ?? PROCEDURE_NOTES.default),
      });

      if (entry.item) {
        entry.item.visitProcedureId = vpId;
        if (entry.item.row) entry.item.row.visitProcedureId = vpId;
      }

      if (entry.status !== 'cancelled') {
        worldProcedures.push({
          id: vpId,
          procedureId: entry.procedure.id,
          teeth: teethCsv,
          quantity: entry.procedure.isPerTooth && entry.teeth ? entry.teeth.length : 1,
          price: entry.price,
          status: entry.status,
          treatmentPlanItemId: entry.item ? entry.item.id : null,
        });
      }
    }

    /* Roughly one diagnosis for every two visits. */
    let diagnosisId = null;
    let diagnosisTooth = null;
    if (story.dx.length && chance(0.5)) {
      const dx = pick(story.dx);
      diagnosisTooth = dx.tooth ? primaryTooth : null;
      diagnosisId = uuid();
      rows.push('visit_diagnoses', {
        id: diagnosisId,
        visitId,
        patientId: skeleton.patientId,
        toothNumber: diagnosisTooth,
        code: dx.code ?? null,
        description: fill(dx.description, primaryTooth),
      });
    }

    /* Chart what the work changed. */
    if (!inProgress && derivedConditions < DERIVED_CONDITION_BUDGET) {
      for (const entry of performed) {
        if (entry.status !== 'completed' || !entry.teeth || !entry.teeth.length) continue;
        if (derivedConditions >= DERIVED_CONDITION_BUDGET) break;
        const tooth = entry.teeth[0];
        const base = {
          patientId: skeleton.patientId,
          toothNumber: tooth,
          visitId,
          diagnosisId: diagnosisTooth === tooth ? diagnosisId : null,
          recordedBy: skeleton.dentistId,
          recordedAt: skeleton.startAt,
        };
        const category = entry.procedure.category;
        let written = null;

        if (category === 'restorative' || category === 'pediatric') {
          written = addCondition({
            ...base,
            surfaces: entry.surfaces,
            conditionType: 'caries',
            status: 'treated',
            notes: 'Excavated and restored with composite.',
            resolvedByVisitId: visitId,
            resolvedAt: skeleton.startAt,
          });
        } else if (category === 'endodontic') {
          written = addCondition({
            ...base,
            conditionType: 'rct',
            status: 'active',
            notes: 'Root canal treatment completed at this visit.',
          });
        // IMP-01 sits in the 'surgical' category alongside the extractions, so
        // it has to be tested first — otherwise placing a fixture charts the
        // tooth as extracted and the implant branch never runs at all.
        } else if (entry.procedure.code === 'IMP-01') {
          written = addCondition({
            ...base,
            conditionType: 'implant',
            status: 'active',
            notes: 'Fixture placed, awaiting the crown.',
          });
        } else if (category === 'surgical') {
          written = addCondition({
            ...base,
            conditionType: 'missing',
            status: 'active',
            notes: 'Extracted at this visit.',
          });
        } else if (category === 'prosthodontic') {
          written = addCondition({
            ...base,
            conditionType: 'crown',
            status: 'active',
            notes: `${entry.procedure.name} fitted.`,
          });
        } else if (category === 'preventive' && entry.procedure.code === 'SEA-01') {
          written = addCondition({ ...base, conditionType: 'sealant', status: 'active', notes: 'Fissure sealant placed.' });
        }

        if (written) derivedConditions += 1;
      }
    }

    const visitEntity = {
      id: visitId,
      patientId: skeleton.patientId,
      branchId: skeleton.branchId,
      dentistId: skeleton.dentistId,
      appointmentId: skeleton.appointmentId,
      visitDate: skeleton.startAt,
      status: skeleton.status,
      procedures: worldProcedures,
      row: visitRow,
    };
    visits.push(visitEntity);

    if (!inProgress && story.rx.length) {
      rxCandidates.push({ visit: visitEntity, kinds: story.rx });
    }
  }

  /* ── Prescriptions ──────────────────────────────────────────────────── */

  // Antibiotic visits come first: an extraction or an abscess with no
  // prescription is the thing a dentist would notice immediately. The rest of
  // the quota is left for the single-drug scripts that follow hygiene and
  // whitening, so the list is not all five-day courses.
  const withAntibiotics = shuffle(rxCandidates.filter((c) => c.kinds.includes('antibiotic')));
  const withoutAntibiotics = shuffle(rxCandidates.filter((c) => !c.kinds.includes('antibiotic')));
  const antibioticShare = Math.min(withAntibiotics.length, Math.round(PRESCRIPTION_TARGET * 0.7));
  const chosen = [
    ...withAntibiotics.slice(0, antibioticShare),
    ...withoutAntibiotics,
    ...withAntibiotics.slice(antibioticShare),
  ].slice(0, PRESCRIPTION_TARGET);

  for (const candidate of chosen) {
    const { visit, kinds } = candidate;
    const drugs = [];

    if (kinds.includes('antibiotic')) {
      drugs.push(chance(0.6) ? DRUGS.augmentin : DRUGS.amoxicillin);
      if (chance(0.35)) drugs.push(DRUGS.metronidazole);
    }
    if (kinds.includes('analgesic') && drugs.length < 3) {
      drugs.push(weighted([[DRUGS.brufen, 4], [DRUGS.ponstan, 3], [DRUGS.panadol, 3]]));
    }
    if (kinds.includes('chx') && drugs.length < 3) drugs.push(DRUGS.chx);
    if (kinds.includes('sensodyne') && drugs.length < 3) drugs.push(DRUGS.sensodyne);
    if (!drugs.length) drugs.push(DRUGS.brufen);

    const prescriptionId = uuid();
    rows.push('prescriptions', {
      id: prescriptionId,
      visitId: visit.id,
      patientId: visit.patientId,
      dentistId: visit.dentistId,
      notes: pick(RX_NOTES),
      createdAt: dt(visit.visitDate),
    });

    drugs.slice(0, 3).forEach((drug, index) => {
      rows.push('prescription_items', {
        id: uuid(),
        prescriptionId,
        drugName: drug.drugName,
        dosage: drug.dosage,
        frequency: drug.frequency,
        durationDays: drug.durationDays,
        instructions: drug.instructions,
        sortOrder: index,
        createdAt: dt(visit.visitDate),
      });
    });
  }

  /* ── Planned findings, tied to the plan item that will treat them ───── */

  const visitByPatient = new Map();
  for (const visit of visits) {
    if (!visitByPatient.has(visit.patientId)) visitByPatient.set(visit.patientId, visit);
  }

  const plannedPatients = shuffle([...pendingByPatient.keys()]).slice(0, 14);
  for (const patientId of plannedPatients) {
    const entry = pendingByPatient.get(patientId).find(({ item }) => !item.toothConditionId);
    if (!entry) continue;
    const { item } = entry;
    const procedure = procById.get(item.procedureId);
    const patient = patientById.get(patientId);
    if (!patient) continue;

    const fromItem = item.teeth ? String(item.teeth).split(',').filter(Boolean)[0] : null;
    const tooth = fromItem ?? freeTooth(patientId, patient.isChild ? 'primary-molar' : 'posterior');
    if (!tooth) continue;

    const host = visitByPatient.get(patientId);
    const recordedAt = host ? host.visitDate : at(nextClinicDay(day(-int(5, 60))), int(10, 17));
    const conditionType = CATEGORY_CONDITION[procedure?.category] ?? 'caries';

    const condition = addCondition({
      patientId,
      toothNumber: tooth,
      surfaces: conditionType === 'caries' ? surfacesFor(tooth) : null,
      conditionType,
      status: 'planned',
      notes: 'Charted with the treatment plan, awaiting the appointment.',
      visitId: host ? host.id : null,
      treatmentPlanItemId: item.id,
      recordedBy: host ? host.dentistId : entry.plan.dentistId,
      recordedAt,
    });

    if (condition) {
      // tooth_conditions.treatmentPlanItemId ↔ treatment_plan_items.toothConditionId
      item.toothConditionId = condition.id;
      if (item.row) item.row.toothConditionId = condition.id;
    }
  }

  /* ── The rest of the chart: what is wrong today, and what is history ── */

  const chartPatients = pickN(patients, Math.min(CHART_PATIENTS, patients.length));
  // Roughly five findings a patient, so a short patient list does not end up
  // with one person carrying the whole chart.
  const chartTarget = Math.min(
    TOOTH_CONDITION_TARGET,
    rows.count('tooth_conditions') + chartPatients.length * 5
  );
  let guard = 0;

  while (rows.count('tooth_conditions') < chartTarget && guard < 900) {
    guard += 1;
    const patient = pick(chartPatients);
    const host = visitByPatient.get(patient.id);
    const recordedBy = host ? host.dentistId : dentistFor(patient.branchId);
    if (!recordedBy) continue;
    const recordedAt = host ? host.visitDate : at(nextClinicDay(day(-int(5, 120))), int(10, 17));

    const table = patient.isChild ? CHILD_FINDINGS : ADULT_FINDINGS;
    const finding = weighted(table.map((entry) => [entry, entry.weight]));

    let tooth;
    if (finding.teeth === 'wisdom') tooth = pick(WISDOM_TEETH);
    else if (finding.teeth === 'gaps') tooth = chance(0.6) ? pick(WISDOM_TEETH) : pick(LOST_MOLARS);
    else tooth = freeTooth(patient.id, finding.teeth);
    if (!tooth) continue;

    addCondition({
      patientId: patient.id,
      toothNumber: tooth,
      surfaces: finding.surfaces ? surfacesFor(tooth) : null,
      conditionType: finding.conditionType,
      status: finding.status,
      notes: finding.note ?? pick(CONDITION_NOTES[finding.conditionType] ?? [null]),
      visitId: host ? host.id : null,
      recordedBy,
      recordedAt,
    });
  }
}
