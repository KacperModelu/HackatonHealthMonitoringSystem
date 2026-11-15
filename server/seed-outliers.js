// Adds demo profiles with STRONG, clearly visible health problems ("outliers").
//
//   npm run seed:outliers          (use CARDIO_DB=... to target a copy of the database)
//
// Every profile is called "Outlier <problem>", so the login list shows at a glance
// what is wrong with whom. They are ordinary app profiles (created_in_app = 1): they
// appear on the login screen and can be deleted there. The script is safe to run
// again: a profile whose name already exists is skipped.
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from './db.js';
import { generate } from './generator.js';
import { scorePsych } from '../src/assessments.js';

// `kinds` are deviation kinds of server/generator.js, generated at severe strength.
// `lowMood` also stores a wellbeing questionnaire with a very low score.
export const OUTLIERS = [
  { name: 'Hypertension (severe)', sex: 'M', age: 52, heightCm: 180, weightKg: 92,
    kinds: ['hypertension'] },
  { name: 'Hypotension + Bradycardia', sex: 'F', age: 34, heightCm: 168, weightKg: 56,
    kinds: ['hypotension', 'bradycardia'] },
  { name: 'Fever + Tachycardia', sex: 'M', age: 41, heightCm: 176, weightKg: 78,
    kinds: ['fever', 'tachycardia'] },
  { name: 'Low Oxygen (SpO2) + High CO2', sex: 'F', age: 45, heightCm: 164, weightKg: 61,
    kinds: ['desaturation', 'co2'] },
  { name: 'Fitness Loss + Stopped Test', sex: 'M', age: 48, heightCm: 183, weightKg: 85,
    kinds: ['deconditioning', 'test_stopped'] },
  { name: 'Abnormal ECG (long QTc)', sex: 'F', age: 39, heightCm: 170, weightKg: 64,
    kinds: ['ecg'], ecg: 'qtc' },
  { name: 'Low Mood + Poor Sleep', sex: 'M', age: 36, heightCm: 178, weightKg: 74,
    kinds: [], lowMood: true },
  { name: 'Multi-System Failure', sex: 'M', age: 55, heightCm: 175, weightKg: 88,
    kinds: ['hypertension', 'fever', 'desaturation', 'deconditioning', 'test_stopped', 'ecg'],
    ecg: 'avb1', lowMood: true },
];

// Worst answer to every question (see PSYCH_QUESTIONS): 7 points of 99, about 7%.
const WORST_ANSWERS = [10, 10, 10, 0, 0, 0, 6, 3, 5, 2];

function addLowMood(db, crewId) {
  const r = scorePsych(WORST_ANSWERS);
  const takenAt = new Date().toISOString().slice(0, 19) + 'Z';
  transaction(db, () => {
    const id = Number(db.prepare(
      'INSERT INTO psych_assessment (crew_id, taken_at, score, max_score, percent) VALUES (?,?,?,?,?)',
    ).run(crewId, takenAt, r.score, r.max, r.percent).lastInsertRowid);
    const ins = db.prepare('INSERT INTO psych_answer VALUES (?,?,?,?,?)');
    r.items.forEach((x, i) => ins.run(id, i + 1, x.question, x.answer, x.points));
  });
}

// Creates the missing outlier profiles; returns [{ name, crewId, skipped }].
export function seedOutliers(db, options = {}) {
  const exists = db.prepare(
    'SELECT id FROM crew_member WHERE first_name = ? AND last_name = ? AND created_in_app = 1',
  );
  return OUTLIERS.map((o) => {
    const found = exists.get('Outlier', o.name);
    if (found) return { name: o.name, crewId: found.id, skipped: true };
    const person = {
      firstName: 'Outlier', lastName: o.name, age: o.age, sex: o.sex,
      heightCm: o.heightCm, weightKg: o.weightKg,
    };
    const { crewId } = generate(db, person, { ...options, outlier: { kinds: o.kinds, ecg: o.ecg } });
    if (o.lowMood) addLowMood(db, crewId);
    return { name: o.name, crewId, skipped: false };
  });
}

// Run directly (not when imported by the tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  for (const r of seedOutliers(db)) {
    console.log(`${r.skipped ? 'exists ' : 'created'}  #${r.crewId}  Outlier ${r.name}`);
  }
  db.close();
}
