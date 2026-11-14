// Generates a FAKE but physiologically plausible
// health record for a new crew member and stores it in the database:
//   * a completed mission (~5–6 months, returned ~5–6 weeks ago),
//   * cycle ergometer tests following the NASA N3.07 schedule
//     (annual, L-12 m, L-90/30 supine + upright, FD 14, FD 75, R-14, R+5, R+30)
//     with per-stage HR/VO2/RPE and blood pressure,
//   * resting ECG before and after flight (MEDB 1.6),
//   * vitals twice a day during the whole flight.
// For variety each person randomly gets 0–3 deviations from the norm. What was
// simulated is stored in simulated_event (source = 'app') as ground truth.
import { transaction } from './db.js';

// Schedule point ids (see schedule_point in the database)
const SP = {
  EcgPre: 1, EcgPost: 2, Annual: 7, L12m: 8, SupineL90: 9, UprightL90: 10,
  FD14: 11, FD75: 12, Rminus14: 13, Rplus5: 15, Rplus30: 16,
};

// Average multiplier of baseline VO2peak per test (N3.07 schedule)
const PHASE_VO2 = { [SP.Annual]: 0.99, [SP.SupineL90]: 0.92, [SP.FD14]: 0.86, [SP.FD75]: 0.9,
  [SP.Rminus14]: 0.92, [SP.Rplus5]: 0.85, [SP.Rplus30]: 0.96 };
const PHASE_WEIGHT = { [SP.FD14]: 0.975, [SP.FD75]: 0.97, [SP.Rminus14]: 0.97,
  [SP.Rplus5]: 0.98, [SP.Rplus30]: 0.995 };
const PHASE_HR_REST = { [SP.SupineL90]: -6, [SP.FD14]: -3, [SP.FD75]: -2, [SP.Rminus14]: -2,
  [SP.Rplus5]: 9, [SP.Rplus30]: 2 };
const AFFECTED_BY_FLIGHT = new Set([SP.FD14, SP.FD75, SP.Rminus14, SP.Rplus5, SP.Rplus30]);

function protocolLoads(light) {
  const loads = [light ? 45 : 50];
  for (let w = light ? 60 : 75; w <= (light ? 300 : 475); w += light ? 15 : 25) loads.push(w);
  return loads;
}

const KINDS = ['hypertension', 'hypotension', 'tachycardia', 'bradycardia', 'fever', 'co2',
  'desaturation', 'artifacts', 'deconditioning', 'ecg', 'test_stopped'];

// --- random helpers ------------------------------------------------------------
export function makeRandom(rand = Math.random) {
  return {
    uni: (a, b) => a + (b - a) * rand(),
    randint: (a, b) => a + Math.floor(rand() * (b - a + 1)),
    gauss: (sd) => {
      const u = 1 - rand();
      return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

// --- date helpers (UTC calendar dates) ---------------------------------------------
const DAY = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
function addYears(d, n) {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}
function ageOn(birth, d) {
  const before = d.getUTCMonth() < birth.getUTCMonth()
    || (d.getUTCMonth() === birth.getUTCMonth() && d.getUTCDate() < birth.getUTCDate());
  return d.getUTCFullYear() - birth.getUTCFullYear() - (before ? 1 : 0);
}
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

class Generator {
  constructor(db, person, { rand, today } = {}) {
    this.db = db;
    this.p = person;
    this.r = makeRandom(rand);
    this.today = today ? toDate(today) : toDate(iso(new Date()));
  }

  insert(sql, args) {
    return Number(this.db.prepare(sql).run(...args).lastInsertRowid);
  }

  run() {
    const { uni, randint, gauss } = this.r;
    const p = this.p;
    const male = p.sex === 'M';

    const height = p.heightCm ?? clamp(male ? 178 + gauss(6) : 166 + gauss(6), 150, 200);
    const weight = p.weightKg ?? clamp(male ? 78 + gauss(8) : 62 + gauss(6), 45, 110);
    this.weight = r1(weight);
    this.light = this.weight < 65;
    this.birth = addDays(addYears(this.today, -p.age), -randint(0, 360));

    // Personal baseline
    this.vo2Base = male ? uni(39, 48) : uni(33, 42);
    this.responder = uni(0.5, 1.3);
    this.hrRest = randint(52, 68);
    this.hrMaxOffset = uni(-6, 6);
    this.sbp = randint(108, 126);
    this.dbp = randint(66, 80);
    this.vtFrac = uni(0.58, 0.7);
    this.skin = uni(33.6, 34.3);
    this.resp = uni(13, 16);
    this.qtc = randint(388, 425) + (male ? 0 : 10);
    this.pr = randint(135, 185);
    this.qrs = randint(84, 102);
    this.axis = randint(10, 75);

    this.crewId = this.insert(
      `INSERT INTO crew_member (first_name, last_name, sex, birth_date, height_cm, weight_kg,
         agency, cycle_protocol, regular_cyclist, created_in_app)
       VALUES (?,?,?,?,?,?,NULL,?,0,1)`,
      [p.firstName, p.lastName, p.sex, iso(this.birth), Math.round(height), this.weight,
        this.light ? 'light' : 'nominal'],
    );

    // A completed mission that ended 5–6 weeks ago, so R+30 has happened.
    this.duration = randint(150, 190);
    this.ret = addDays(this.today, -randint(35, 45));
    this.launch = addDays(this.ret, -this.duration);
    const mission = `SIM-${String(this.crewId).padStart(3, '0')}`;
    this.missionId = this.insert('INSERT INTO mission (name, launch_date, return_date) VALUES (?,?,?)',
      [mission, iso(this.launch), iso(this.ret)]);
    this.insert('INSERT INTO crew_assignment (crew_id, mission_id, role) VALUES (?,?,?)',
      [this.crewId, this.missionId, 'Flight Engineer']);

    this.pickEvents();
    const result = {
      crewId: this.crewId,
      mission,
      vitalsReadings: this.vitals(),
      cycleTests: this.cycleTests(),
      ecgs: this.ecgs(),
      events: [],
    };

    for (const e of this.events) {
      this.insert(
        `INSERT INTO simulated_event (crew_id, mission_id, kind, start_flight_day, end_flight_day,
           description, source) VALUES (?,?,?,?,?,?,'app')`,
        [this.crewId, this.missionId, e.code, e.start || null, e.end || null, e.text],
      );
      result.events.push({ kind: e.code, text: e.text, start: e.start || null, end: e.end || null });
    }
    return result;
  }

  // --- deviations from the norm --------------------------------------------------
  pickEvents() {
    const { uni, randint, shuffle } = this.r;
    const x = uni(0, 1);
    const count = x < 0.2 ? 0 : x < 0.6 ? 1 : x < 0.88 ? 2 : 3;
    const pool = shuffle([...KINDS]);
    const d = this.duration;
    const span = (minLen, maxLen, earliest = 0.05) => {
      const len = randint(minLen, maxLen);
      const start = randint(Math.max(2, Math.floor(d * earliest)), d - len - 2);
      return [start, start + len - 1];
    };

    this.events = [];
    this.artifacts = new Set();       // flight_day * 2 + slot
    this.ecgSpecial = null;
    this.testStopped = false;

    for (const kind of pool.slice(0, count)) {
      const e = { kind, start: 0, end: 0 };
      switch (kind) {
        case 'hypertension': {
          const start = randint(Math.floor(d * 0.4), Math.floor(d * 0.7));
          e.start = start;
          e.end = Math.min(d, start + randint(25, 50));
          e.code = 'hypertension';
          e.text = 'Rising blood pressure trend';
          break;
        }
        case 'hypotension':
          [e.start, e.end] = span(4, 8);
          e.code = 'hypotension';
          e.text = 'Low blood pressure episode (e.g. dehydration)';
          break;
        case 'tachycardia':
          [e.start, e.end] = span(3, 6);
          e.code = 'tachycardia';
          e.text = 'High resting heart rate (stress, poor sleep or illness)';
          break;
        case 'bradycardia':
          [e.start, e.end] = span(10, 20);
          e.code = 'bradycardia';
          e.text = 'Resting heart rate about 13 bpm lower than usual';
          break;
        case 'fever':
          [e.start, e.end] = span(3, 6);
          e.code = 'fever';
          e.text = 'Mild infection: skin temperature, heart rate and breathing up';
          break;
        case 'co2':
          [e.start, e.end] = span(3, 5);
          e.code = 'co2';
          e.text = 'Elevated cabin CO2: faster breathing, lower SpO2';
          break;
        case 'desaturation':
          [e.start, e.end] = span(1, 3);
          e.code = 'desaturation';
          e.text = 'Marked drop in blood oxygen (SpO2 below 92%)';
          break;
        case 'artifacts': {
          const n = randint(4, 8);
          for (let k = 0; k < n; k++) this.artifacts.add(randint(1, d) * 2 + randint(0, 1));
          e.code = 'sensor_artifacts';
          e.text = `${this.artifacts.size} isolated sensor artifacts (implausible single readings)`;
          break;
        }
        case 'deconditioning':
          this.responder = uni(1.8, 2.1);
          e.code = 'deconditioning';
          e.text = 'Strong loss of aerobic fitness in flight (VO2peak down ~25–30%)';
          break;
        case 'ecg': {
          const type = ['avb1', 'qtc', 'pvc'][randint(0, 2)];
          this.ecgSpecial = type;
          e.code = `ecg_${type}`;
          e.text = type === 'avb1' ? 'First-degree AV block on postflight ECG'
            : type === 'qtc' ? 'Prolonged QTc on postflight ECG'
              : 'Premature ventricular complexes on postflight ECG';
          break;
        }
        case 'test_stopped':
          this.testStopped = true;
          e.code = 'test_terminated';
          e.text = 'R+5 cycle test stopped for unusual shortness of breath';
          break;
        default:
          break;
      }
      this.events.push(e);
    }
  }

  // --- in-flight vitals, twice a day -------------------------------------------
  vitals() {
    const { uni, randint, gauss } = this.r;
    const stmt = this.db.prepare(
      `INSERT INTO vitals_reading (crew_id, mission_id, measured_at, flight_day, systolic_mmhg,
         diastolic_mmhg, heart_rate_bpm, resp_rate_bpm, skin_temp_c, spo2_pct)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    let rows = 0;
    for (let fd = 1; fd <= this.duration; fd++) {
      const day = iso(addDays(this.launch, fd - 1));
      const adapt = Math.min(fd / 10, 1);          // fluid shift settles in ~10 days
      for (let slot = 0; slot < 2; slot++) {
        const evening = slot === 1;
        const time = `${evening ? '19' : '06'}:${String(randint(0, 50)).padStart(2, '0')}`;
        let sbp = this.sbp - 4 * adapt + (evening ? 3 : 0) + gauss(4);
        let dbp = this.dbp - 2 * adapt + gauss(3);
        let hr = this.hrRest + 3 - 3 * adapt + (evening ? 6 : 0) + gauss(3);
        let resp = this.resp + gauss(0.9);
        let skin = this.skin + (evening ? 0.3 : 0) + gauss(0.25);
        let spo2 = 97.6 + gauss(0.6);

        for (const e of this.events) {
          if (!e.start || fd < e.start || fd > e.end) continue;
          switch (e.kind) {
            case 'hypertension': {
              const k = (fd - e.start) / Math.max(e.end - e.start, 1);
              sbp += 12 + 16 * k;
              dbp += 7 + 9 * k;
              break;
            }
            case 'hypotension':
              sbp -= 20 + uni(0, 6);
              dbp -= 10 + uni(0, 4);
              hr += 8;
              break;
            case 'tachycardia':
              hr = 102 + uni(0, 18) + (evening ? 5 : 0);   // resting HR > 100
              resp += 1.5;
              break;
            case 'bradycardia':
              hr -= 13;
              break;
            case 'fever':
              skin += 1.5 + uni(0, 0.5);
              hr += 14;
              resp += 2.5;
              break;
            case 'co2':
              resp += 4.5 + uni(0, 1.5);
              spo2 -= 2.3 + uni(0, 1.2);
              hr += 6;
              break;
            case 'desaturation':
              spo2 -= 6 + uni(0, 2.5);
              resp += 3;
              hr += 10;
              break;
            default:
              break;
          }
        }

        if (this.artifacts.has(fd * 2 + slot)) {
          switch (randint(0, 3)) {
            case 0: spo2 = uni(80, 86); break;      // cold finger / loose probe
            case 1: hr = uni(140, 170); break;      // motion artifact
            case 2: skin = uni(29.5, 30.8); break;  // sensor lost skin contact
            default: sbp = uni(175, 195); break;    // cuff too small / talking
          }
        }

        stmt.run(this.crewId, this.missionId, `${day}T${time}Z`, fd, Math.round(sbp),
          Math.round(dbp), Math.round(hr), r1(resp), r1(skin), r1(Math.min(spo2, 100)));
        rows++;
      }
    }
    return rows;
  }

  // --- cycle ergometer tests (N3.07) ---------------------------------------------
  cycleTests() {
    const { randint } = this.r;
    const parvo = 'Parvo Medics TrueOne 2400';
    let n = 0;
    const t = (...args) => { this.cycleTest(...args); n++; };
    t(SP.Annual, addDays(this.launch, -randint(480, 540)), 'upright', 'JSC', parvo, false);
    t(SP.L12m, addDays(this.launch, -365 + randint(-30, 30)), 'upright', 'JSC', 'PPFS', false);
    const upright = addDays(this.launch, -randint(32, 60));
    t(SP.SupineL90, addDays(upright, -randint(2, 12)), 'supine', 'JSC',
      randint(0, 1) ? 'PPFS' : parvo, false);
    t(SP.UprightL90, upright, 'upright', 'JSC', 'PPFS', false);
    t(SP.FD14, addDays(this.launch, 13 + randint(-2, 2)), null, 'ISS', 'PPFS', true);
    t(SP.FD75, addDays(this.launch, 74 + randint(-7, 7)), null, 'ISS', 'PPFS', true);
    t(SP.Rminus14, addDays(this.ret, -14 + randint(-5, 5)), null, 'ISS', 'PPFS', true);
    t(SP.Rplus5, addDays(this.ret, 5 + randint(-2, 2)), 'upright', 'JSC', 'PPFS', false,
      this.testStopped);
    const r30 = addDays(this.ret, 30 + randint(-4, 4));
    if (r30 <= this.today) t(SP.Rplus30, r30, 'upright', 'JSC', 'PPFS', false);
    return n;
  }

  cycleTest(sp, d, position, location, analyzer, inflight, stopped = false) {
    const { uni, randint } = this.r;
    const sid = this.insert(
      `INSERT INTO test_session (crew_id, mission_id, schedule_point_id, session_date, position,
         location, gas_analyzer, status, termination_id, maximal_effort, notes)
       VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
      [this.crewId, sp === SP.Annual ? null : this.missionId, sp, iso(d), position, location,
        analyzer, stopped ? 'terminated' : 'completed', stopped ? 5 : 7,
        stopped ? 'Dyspnea out of proportion to workload; test stopped. Follow-up at R+30.' : null],
    );

    const weight = this.weight * (PHASE_WEIGHT[sp] ?? 1) * uni(0.99, 1.01);
    const loss = (1 - (PHASE_VO2[sp] ?? 1)) * (AFFECTED_BY_FLIGHT.has(sp) ? this.responder : 1);
    let vo2peak = this.vo2Base * (1 - loss) * uni(0.97, 1.03);
    if (stopped) vo2peak *= uni(0.8, 0.88);

    const loads = protocolLoads(this.light);
    let targetW = ((vo2peak - 7) * weight) / 10.8;          // ACSM leg cycling
    if (inflight) targetW = Math.min(targetW, 350);         // CEVIS limit
    const stages = loads.filter((w) => w <= targetW);
    if (!stages.length) stages.push(loads[0]);
    const peakW = stages.at(-1);
    const partial = peakW < loads.at(-1) ? randint(5, 55) : 0;
    const exerciseSec = 180 + 60 * (stages.length - 1) + partial
      + (inflight && peakW === 350 ? 120 : 0);

    const hrRest = this.hrRest + (PHASE_HR_REST[sp] ?? 0) + randint(-3, 3);
    let hrPeak = Math.round(208 - 0.7 * ageOn(this.birth, d) + this.hrMaxOffset + uni(-3, 3));
    if (position === 'supine') hrPeak -= randint(4, 9);
    if (sp === SP.Rplus5) hrPeak += randint(0, 5);
    if (stopped) hrPeak -= randint(8, 15);

    const gas = !!analyzer;
    const vtFrac = this.vtFrac * (sp === SP.Rplus5 ? 0.93 : 1) * uni(0.97, 1.03);
    const rer = stopped ? uni(1.0, 1.06) : uni(1.1, 1.24);
    const rpePeak = inflight ? null : stopped ? randint(15, 17) : randint(18, 20);
    const vo2Rest = 3.5;

    const stage = this.db.prepare('INSERT INTO stage_measurement VALUES (?,?,?,?,?,?)');
    stage.run(sid, 0, 0, hrRest + randint(4, 9), gas ? r1(vo2Rest + uni(0.2, 1)) : null,
      inflight ? null : 6);
    stages.forEach((w, i) => {
      const vo2 = Math.min((10.8 * w) / weight + 7, vo2peak);
      const frac = (vo2 - vo2Rest) / (vo2peak - vo2Rest);
      const hr = Math.min(hrPeak,
        Math.round(hrRest + 8 + (hrPeak - hrRest - 8) * frac ** 1.05 + uni(-2, 2)));
      const rpe = inflight ? null : clamp(Math.round(6 + (rpePeak - 6) * frac ** 1.3), 6, 20);
      stage.run(sid, i + 1, w, hr, gas ? r1(vo2 * uni(0.97, 1.03)) : null, rpe);
    });

    const hrr1 = randint(14, 30) - (sp === SP.Rplus5 ? 6 : 0);
    this.db.prepare('INSERT INTO cycle_test_result VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      sid, this.light ? 'light' : 'nominal', peakW, exerciseSec,
      gas ? r2((vo2peak * weight) / 1000) : null,
      gas ? r1(vo2peak) : null,
      gas ? r1(vo2peak * vtFrac) : null,
      gas ? r1(vtFrac * 100) : null,
      hrRest, hrPeak, gas ? r2(rer) : null, rpePeak, hrr1,
    );

    // Blood pressure: pretest, every 2nd stage + peak, 5 minutes of recovery
    const sbp0 = this.sbp + (sp === SP.Rplus5 ? 6 : 0) + randint(-4, 4);
    const dbp0 = this.dbp + (sp === SP.Rplus5 ? 4 : 0) + randint(-3, 3);
    const bpStmt = this.db.prepare('INSERT INTO bp_measurement VALUES (?,?,?,?,?,?)');
    let seq = 0;
    const bp = (tp, s, dia, hr) => bpStmt.run(sid, ++seq, tp, Math.round(s), Math.round(dia), hr);
    bp('supine_rest', sbp0 - 2, dbp0, hrRest);
    bp('seated_rest', sbp0 + 2, dbp0, hrRest + 5);
    for (let n = 1; n <= stages.length; n++) {
      if (n % 2 !== 0 && n !== stages.length) continue;
      const w = stages[n - 1];
      const frac = w / peakW;
      bp(`stage_${n}`, sbp0 + 0.27 * w + randint(-6, 6), dbp0 + randint(-6, 4) - 4 * frac,
        Math.round(hrRest + (hrPeak - hrRest) * frac ** 1.1));
    }
    const sbpPeak = sbp0 + 0.27 * peakW;
    let hrNow = hrPeak;
    for (let minute = 1; minute <= 5; minute++) {
      hrNow -= minute === 1 ? hrr1 : randint(5, 10);
      bp(`recovery_${minute}`, sbp0 + (sbpPeak - sbp0) * Math.exp(-0.45 * minute) + randint(-5, 5),
        dbp0 + randint(-5, 3), Math.max(hrNow, hrRest + 10));
    }
  }

  // --- resting ECG (MEDB 1.6) ----------------------------------------------------
  ecgs() {
    const { randint } = this.r;
    this.ecg(SP.EcgPre, addDays(this.launch, -randint(20, 120)), false);
    this.ecg(SP.EcgPost, addDays(this.ret, randint(0, 3)), true);
    return 2;
  }

  ecg(sp, d, post) {
    const { randint } = this.r;
    const sid = this.insert(
      `INSERT INTO test_session (crew_id, mission_id, schedule_point_id, session_date, position,
         location, gas_analyzer, status, termination_id, maximal_effort, notes)
       VALUES (?,?,?,?,'supine','JSC',NULL,'completed',NULL,NULL,NULL)`,
      [this.crewId, this.missionId, sp, iso(d)],
    );
    const hr = this.hrRest - 4 + randint(-3, 3) + (post ? 9 : 0);
    let pr = this.pr + randint(-6, 6);
    const qrs = this.qrs + randint(-3, 3);
    let qtc = this.qtc + randint(-6, 6) + (post ? 9 : 0);
    let rhythm = 'Sinus rhythm';
    let finding = 'Normal ECG';
    let abnormal = 0;
    if (hr < 50) {
      rhythm = 'Sinus bradycardia';
      finding = 'Sinus bradycardia, physiologic (trained athlete)';
    }
    if (post && this.ecgSpecial === 'avb1') {
      pr = randint(208, 236);
      finding = 'First-degree AV block';
      abnormal = 1;
    } else if (post && this.ecgSpecial === 'qtc') {
      qtc = this.p.sex === 'F' ? randint(462, 480) : randint(452, 470);
      finding = 'Borderline prolonged QTc';
      abnormal = 1;
    } else if (post && this.ecgSpecial === 'pvc') {
      finding = 'Isolated premature ventricular complexes';
      abnormal = 1;
    }
    const qt = Math.round(qtc * Math.sqrt(60 / hr));
    this.db.prepare('INSERT INTO ecg_result VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      sid, hr, pr, qrs, qt, qtc, this.axis + randint(-5, 5), rhythm, finding, abnormal,
      iso(addDays(d, randint(2, 5))),
    );
  }
}

const text = (v) => String(v ?? '').trim();
const FIELD_LABELS = {
  firstName: 'name', lastName: 'surname', age: 'age', sex: 'biological sex', heightCm: 'height', weightKg: 'weight',
};

// Checks the form input; every field is required. Returns { person } or { error, fields }.
export function validatePerson(body = {}) {
  const missing = Object.keys(FIELD_LABELS).filter((k) => !text(body[k]));
  if (missing.length) {
    return { error: `Please fill in: ${missing.map((k) => FIELD_LABELS[k]).join(', ')}.`, fields: missing };
  }

  const age = Number(text(body.age));
  if (!Number.isInteger(age) || age < 18 || age > 99) {
    return { error: 'Age must be a number between 18 and 99.', fields: ['age'] };
  }
  if (body.sex !== 'M' && body.sex !== 'F') {
    return { error: 'Please choose biological sex.', fields: ['sex'] };
  }
  const number = (value, min, max) => {
    const v = Number(text(value).replace(',', '.'));
    return Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const heightCm = number(body.heightCm, 120, 230);
  if (heightCm === null) return { error: 'Height must be in cm (120–230).', fields: ['heightCm'] };
  const weightKg = number(body.weightKg, 35, 200);
  if (weightKg === null) return { error: 'Weight must be in kg (35–200).', fields: ['weightKg'] };

  return {
    person: { firstName: text(body.firstName), lastName: text(body.lastName), age, sex: body.sex, heightCm, weightKg },
  };
}

// Runs in a single transaction: either everything is stored or nothing.
export function generate(db, person, options) {
  return transaction(db, () => new Generator(db, person, options).run());
}
