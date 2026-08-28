import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createRows } from '/Users/mosavr/Documents/yladmin-main/scripts/seed/context.mjs';
import buildOrg from '/Users/mosavr/Documents/yladmin-main/scripts/seed/01-org.mjs';
import buildPatients from '/Users/mosavr/Documents/yladmin-main/scripts/seed/02-patients.mjs';
import buildPlans from '/Users/mosavr/Documents/yladmin-main/scripts/seed/03-plans.mjs';
import buildScheduling from '/Users/mosavr/Documents/yladmin-main/scripts/seed/04-scheduling.mjs';
import buildClinical from '/Users/mosavr/Documents/yladmin-main/scripts/seed/05-clinical.mjs';

const KEEP = {
  branchId: '54b330c3-8df1-4b53-8a04-aa820aefcd96',
  ownerId: '185fcba5-e9a4-44c7-aa6b-4a31a1f0116d',
  chairIds: ['fe332cc2-e14f-4fc9-bb9f-8028d477fce0', '15c0f2d0-49e2-4d93-9af9-d666c352f85c'],
};
let conn;
for (let i=0;i<40;i++){ try { conn = await mysql.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT||3306,user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,ssl:{rejectUnauthorized:false},timezone:'Z'}); break;} catch(e){ if(e.code!=='ER_CON_COUNT_ERROR') throw e; await new Promise(r=>setTimeout(r,3000)); } }
const [branchRows] = await conn.query('SELECT * FROM branches');
const [chairRows] = await conn.query('SELECT * FROM chairs');
const [roleRows] = await conn.query('SELECT id, name FROM admin_roles');
const [procRows] = await conn.query('SELECT id, code, name, category, defaultPrice, durationMinutes, isPerTooth, defaultRecallMonths FROM procedures WHERE isActive = 1');
const [ownerRows] = await conn.query('SELECT id, email, name FROM admin_users WHERE id = ?', [KEEP.ownerId]);
const [colRows] = await conn.query("SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?", [process.env.DB_NAME]);
await conn.end();

const schema = new Map();
for (const c of colRows) {
  if (!schema.has(c.TABLE_NAME)) schema.set(c.TABLE_NAME, new Map());
  schema.get(c.TABLE_NAME).set(c.COLUMN_NAME, c);
}

const mainBranch = branchRows.find((b) => b.id === KEEP.branchId) ?? branchRows[0];
const owner = ownerRows[0];
const world = {
  roles: Object.fromEntries(roleRows.map((r) => [r.name, r.id])),
  procedures: procRows.map((p) => ({ ...p, isPerTooth: Boolean(p.isPerTooth) })),
  branches: [{ id: mainBranch.id, name: mainBranch.name, code: mainBranch.code, city: mainBranch.city, isMain: true }],
  chairs: chairRows.filter((c) => KEEP.chairIds.includes(c.id)).map((c) => ({ id: c.id, branchId: c.branchId, name: c.name })),
  staff: owner ? [{ id: owner.id, name: owner.name, email: owner.email, password: null, roleId: roleRows.find((r) => r.name === 'Admin / Owner')?.id, roleName: 'Admin / Owner', branchId: null, staffType: 'owner', isClinical: true, isActive: true, preexisting: true }] : [],
  credentials: [], patients: [], portalUsers: [], plans: [], appointments: [], recalls: [], visits: [], invoices: [], leads: [], tasks: [],
};

const rows = createRows();
buildOrg(world, rows); buildPatients(world, rows); buildPlans(world, rows); buildScheduling(world, rows);
const before = new Map([...rows.all()].map(([k,v])=>[k,v.length]));
buildClinical(world, rows);

console.log('\n=== row counts produced by 05 ===');
const CLINICAL = ['visits','visit_procedures','visit_diagnoses','tooth_conditions','prescriptions','prescription_items'];
for (const t of CLINICAL) console.log('  '+t.padEnd(20), (rows.count(t) - (before.get(t)||0)));

/* ---- validate every clinical row against the live schema ---- */
const DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
let problems = 0;
const seen = new Map();
for (const t of CLINICAL) {
  const cols = schema.get(t);
  const list = (rows.all().get(t) || []).slice(before.get(t)||0);
  for (const row of list) {
    for (const [k, v] of Object.entries(row)) {
      const col = cols.get(k);
      if (!col) { console.log(`  UNKNOWN COLUMN ${t}.${k}`); problems++; continue; }
      if (v === null || v === undefined) {
        if (col.IS_NULLABLE === 'NO' && col.COLUMN_DEFAULT === null) { console.log(`  NULL IN NOT-NULL ${t}.${k}`); problems++; }
        continue;
      }
      if (col.DATA_TYPE === 'datetime' && !DT.test(String(v))) { console.log(`  BAD DATETIME ${t}.${k} = ${JSON.stringify(v)}`); problems++; }
      if (col.CHARACTER_MAXIMUM_LENGTH && typeof v === 'string' && v.length > col.CHARACTER_MAXIMUM_LENGTH) {
        console.log(`  OVERFLOW ${t}.${k} len=${v.length} > ${col.CHARACTER_MAXIMUM_LENGTH}: ${JSON.stringify(v)}`); problems++;
      }
      if ((col.DATA_TYPE === 'int') && !Number.isInteger(v)) { console.log(`  NON-INT ${t}.${k} = ${JSON.stringify(v)}`); problems++; }
      const key = `${t}.${k}`;
      if (!seen.has(key)) seen.set(key, new Set());
      if (seen.get(key).size < 60) seen.get(key).add(typeof v === 'string' && v.length < 40 ? v : `<${typeof v}>`);
    }
    // required columns never set at all
    for (const [k, col] of cols) {
      if (!(k in row) && col.IS_NULLABLE === 'NO' && col.COLUMN_DEFAULT === null) { console.log(`  MISSING REQUIRED ${t}.${k}`); problems++; }
    }
  }
}
console.log('\nschema problems:', problems);

/* ---- referential integrity within the built world ---- */
const ids = (t) => new Set((rows.all().get(t)||[]).map(r=>r.id));
const patientIds = ids('patients'), staffIds = ids('admin_users'), branchIds = new Set(world.branches.map(b=>b.id));
staffIds.add(KEEP.ownerId); branchIds.add(KEEP.branchId);
const visitIds = ids('visits'), procIds = new Set(procRows.map(p=>p.id)), apptIds = ids('appointments');
const itemIds = ids('treatment_plan_items'), rxIds = ids('prescriptions'), condIds = ids('tooth_conditions'), dxIds = ids('visit_diagnoses');
const REF = [
  ['visits','patientId',patientIds],['visits','branchId',branchIds],['visits','dentistId',staffIds],['visits','appointmentId',apptIds],
  ['visit_procedures','visitId',visitIds],['visit_procedures','patientId',patientIds],['visit_procedures','procedureId',procIds],
  ['visit_procedures','performedBy',staffIds],['visit_procedures','treatmentPlanItemId',itemIds],
  ['visit_diagnoses','visitId',visitIds],['visit_diagnoses','patientId',patientIds],
  ['tooth_conditions','patientId',patientIds],['tooth_conditions','visitId',visitIds],['tooth_conditions','recordedBy',staffIds],
  ['tooth_conditions','diagnosisId',dxIds],['tooth_conditions','treatmentPlanItemId',itemIds],['tooth_conditions','resolvedByVisitId',visitIds],
  ['prescriptions','visitId',visitIds],['prescriptions','patientId',patientIds],['prescriptions','dentistId',staffIds],
  ['prescription_items','prescriptionId',rxIds],
];
let dangling = 0;
for (const [t,c,pool] of REF) {
  const bad = (rows.all().get(t)||[]).filter(r=>r[c]!=null && !pool.has(r[c]));
  if (bad.length) { console.log(`  DANGLING ${t}.${c}: ${bad.length}`); dangling += bad.length; }
}
console.log('dangling refs:', dangling);

/* ---- enum + distinct value survey ---- */
console.log('\n=== distinct values ===');
for (const k of ['visits.status','visit_procedures.status','tooth_conditions.status','tooth_conditions.conditionType','visits.bloodPressure','tooth_conditions.surfaces','visit_procedures.surfaces','visit_diagnoses.code']) {
  if (seen.has(k)) console.log('  '+k.padEnd(34), [...seen.get(k)].sort().join(', ').slice(0,300));
}

/* ---- pointer pair: treatment_plan_items.visitProcedureId <-> visit_procedures.treatmentPlanItemId ---- */
const vpByItem = new Map();
for (const vp of rows.all().get('visit_procedures')||[]) if (vp.treatmentPlanItemId) {
  if (!vpByItem.has(vp.treatmentPlanItemId)) vpByItem.set(vp.treatmentPlanItemId, []);
  vpByItem.get(vp.treatmentPlanItemId).push(vp);
}
let pairBad = 0, pairOk = 0, dupItem = 0;
for (const [itemId, list] of vpByItem) { if (list.length > 1) dupItem++; }
for (const item of rows.all().get('treatment_plan_items')||[]) {
  if (!item.visitProcedureId) continue;
  const vp = (rows.all().get('visit_procedures')||[]).find(v=>v.id===item.visitProcedureId);
  if (!vp || vp.treatmentPlanItemId !== item.id) pairBad++; else pairOk++;
}
console.log('\nplan-item <-> visit-procedure pairs ok:', pairOk, 'broken:', pairBad, 'items with >1 vp:', dupItem);
console.log('vp rows carrying treatmentPlanItemId:', vpByItem.size);

/* ---- toothConditionId back-pointer ---- */
let tcPairOk=0, tcPairBad=0;
for (const item of rows.all().get('treatment_plan_items')||[]) {
  if (!item.toothConditionId) continue;
  const tc = (rows.all().get('tooth_conditions')||[]).find(c=>c.id===item.toothConditionId);
  if (!tc || tc.treatmentPlanItemId !== item.id) tcPairBad++; else tcPairOk++;
}
console.log('plan-item <-> tooth-condition pairs ok:', tcPairOk, 'broken:', tcPairBad);

/* ---- implant sanity ---- */
const impProc = procRows.find(p=>p.code==='IMP-01');
const impVps = (rows.all().get('visit_procedures')||[]).filter(v=>v.procedureId===impProc.id && v.status==='completed');
console.log('\nIMP-01 completed procedures:', impVps.length);
for (const vp of impVps.slice(0,6)) {
  const cond = (rows.all().get('tooth_conditions')||[]).filter(c=>c.visitId===vp.visitId && c.toothNumber===(vp.teeth||'').split(',')[0]);
  console.log('   visit', vp.visitId.slice(0,8), 'tooth', vp.teeth, '->', cond.map(c=>c.conditionType+'/'+c.status).join(', ') || '(none)');
}

/* ---- money ---- */
const prices = (rows.all().get('visit_procedures')||[]).map(r=>r.price);
console.log('\nprice: all ints?', prices.every(Number.isInteger), 'min', Math.min(...prices), 'max', Math.max(...prices));

/* ---- visit date sanity ---- */
const vs = rows.all().get('visits')||[];
console.log('visitDate range', vs.map(v=>v.visitDate).sort()[0], '->', vs.map(v=>v.visitDate).sort().slice(-1)[0]);
console.log('in_progress visits:', vs.filter(v=>v.status==='in_progress').length, 'completed:', vs.filter(v=>v.status==='completed').length);

/* ---- how often is IMP-01 the forced/plan-linked procedure? ---- */
const impId = impProc.id;
const impLinked = (rows.all().get('visit_procedures')||[]).filter(v=>v.procedureId===impId && v.treatmentPlanItemId);
console.log('\nIMP-01 vp rows linked to a plan item:', impLinked.length);
for (const vp of impLinked) {
  const v = (rows.all().get('visits')||[]).find(x=>x.id===vp.visitId);
  console.log('   visit notes:', JSON.stringify(String(v.treatmentNotes).slice(0,70)));
}
/* pending IMP-01 plan items charted as a condition */
const impItems = new Set((rows.all().get('treatment_plan_items')||[]).filter(i=>i.procedureId===impId).map(i=>i.id));
const impConds = (rows.all().get('tooth_conditions')||[]).filter(c=>c.treatmentPlanItemId && impItems.has(c.treatmentPlanItemId));
console.log('planned conditions charted for IMP-01 items:', impConds.map(c=>c.conditionType+'/'+c.status+'/'+c.toothNumber).join(', ')||'(none)');

/* derived vs background split */
const tc = rows.all().get('tooth_conditions')||[];
console.log('\ntooth_conditions with visitId:', tc.filter(c=>c.visitId).length, 'without:', tc.filter(c=>!c.visitId).length);
console.log('  resolved (treated):', tc.filter(c=>c.resolvedByVisitId).length);
const byType = {}; for (const c of tc) byType[c.conditionType]=(byType[c.conditionType]||0)+1;
console.log('  by type:', JSON.stringify(byType));
/* any surgical-category derived rows on implant teeth */
const surgProcIds = new Set(procRows.filter(p=>p.category==='surgical').map(p=>p.id));
console.log('\nsurgical vp rows (incl IMP-01):', (rows.all().get('visit_procedures')||[]).filter(v=>surgProcIds.has(v.procedureId)).length);
/* createdAt presence */
for (const t of CLINICAL) {
  const l = rows.all().get(t)||[]; console.log(t.padEnd(20), 'has createdAt on rows:', l.filter(r=>'createdAt' in r).length + '/' + l.length);
}

const DERIVED_NOTES = /Excavated and restored|Root canal treatment completed|Extracted at this visit|Fixture placed|fitted\.$|Fissure sealant placed/;
const derived = tc.filter(c=>DERIVED_NOTES.test(String(c.notes||'')));
const planned = tc.filter(c=>c.status==='planned');
console.log('\nderived from visits:', derived.length, ' planned:', planned.length, ' background:', tc.length - derived.length - planned.length);
const bg = tc.filter(c=>!DERIVED_NOTES.test(String(c.notes||'')) && c.status!=='planned');
const bgType = {}; for (const c of bg) bgType[c.conditionType]=(bgType[c.conditionType]||0)+1;
console.log('background by type:', JSON.stringify(bgType));
