// REST API used by the React app.
import express from 'express';
import { plain, transaction } from './db.js';
import { generate, validatePerson } from './generator.js';
import { computeSummary, localToday } from './gamification.js';
import { SATELLITE_GROUPS, getGroup } from './satellites.js';
import { COGNITIVE_TESTS, PSYCH_THRESHOLD, scorePsych, testByCode } from '../src/assessments.js';

// Current time as an ISO string in UTC, cut to whole seconds: 2026-11-15T10:42:07Z
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';

// Age in full years on `today`. Both dates are 'YYYY-MM-DD' strings; one year is
// subtracted when this year's birthday has not happened yet.
const ageFrom = (birth, today = localToday()) => {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
};

// Builds the router with every /api endpoint. The database handle is passed in (not
// imported), so the tests can run the same API on a temporary copy of the database.
// There is no authentication: "logging in" only means choosing a profile on the login
// screen, and every endpoint trusts the crew id in the URL.
export function createApi(db) {
  const api = express.Router();
  api.use(express.json());   // parse JSON request bodies into req.body

  const crewExists = (id) => db.prepare('SELECT 1 FROM crew_member WHERE id = ?').get(id);

  // Preloaded (reference NASA) crew stay in the database for the reference tables,
  // but nobody can view their health data. DELETE is allowed for every profile.
  // api.param runs before any route that has ":id" in its path, so this one check
  // covers dashboard, tasks, wellbeing, journal and cognitive endpoints at once.
  // Unknown ids fall through: each route then answers 404 itself.
  api.param('id', (req, res, next, raw) => {
    if (req.method === 'DELETE') return next();
    const row = db.prepare('SELECT created_in_app FROM crew_member WHERE id = ?').get(Number(raw));
    if (row && row.created_in_app !== 1) {
      return res.status(403).json({ error: 'Preloaded users are not accessible.' });
    }
    next();
  });

  // --- crew list (login screen) --------------------------------------------------
  api.get('/crew', (_req, res) => {
    const rows = db.prepare(
      // Only profiles created in the app are listed. The subquery picks the name of
      // each person's most recent mission (NULL when they have none).
      `SELECT c.id, c.first_name, c.last_name, c.sex, c.birth_date, c.created_in_app,
              (SELECT m.name FROM crew_assignment a JOIN mission m ON m.id = a.mission_id
               WHERE a.crew_id = c.id ORDER BY m.launch_date DESC LIMIT 1) AS mission
       FROM crew_member c WHERE c.created_in_app = 1 ORDER BY c.last_name, c.first_name`,
    ).all();
    res.json(rows.map((r) => ({
      id: r.id,
      name: `${r.first_name} ${r.last_name}`,
      sex: r.sex,
      age: ageFrom(r.birth_date),
      mission: r.mission,
      createdInApp: r.created_in_app === 1,
    })));
  });

  // --- "Generate user data" ------------------------------------------------------
  // 400 = the form input is wrong (`fields` names the inputs to highlight),
  // 201 = profile and full fake health record created, 500 = generation failed
  // (the transaction in generate() has then rolled everything back).
  api.post('/crew', (req, res) => {
    const { person, error, fields } = validatePerson(req.body);
    if (error) return res.status(400).json({ error, fields });
    try {
      res.status(201).json(generate(db, person));
    } catch (err) {
      res.status(500).json({ error: `Could not generate data: ${err.message}` });
    }
  });

  // --- delete user (any profile, including preloaded reference crew) -------------
  api.delete('/crew/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    // The schema has no ON DELETE CASCADE, so rows are removed by hand, children
    // before parents (foreign keys are enforced): results of test sessions → the
    // person's own rows → the person → missions nobody uses any more.
    transaction(db, () => {
      const sessions = 'SELECT id FROM test_session WHERE crew_id = ?';
      for (const t of ['ecg_result', 'cycle_test_result', 'stage_measurement', 'bp_measurement']) {
        db.prepare(`DELETE FROM ${t} WHERE session_id IN (${sessions})`).run(id);
      }
      const missions = plain(db.prepare(
        'SELECT mission_id FROM crew_assignment WHERE crew_id = ?',
      ).all(id)).map((m) => m.mission_id);
      db.prepare(`DELETE FROM psych_answer WHERE assessment_id IN
                  (SELECT id FROM psych_assessment WHERE crew_id = ?)`).run(id);
      for (const t of ['test_session', 'vitals_reading', 'task_completion', 'simulated_event',
        'psych_assessment', 'journal_entry', 'cognitive_result', 'crew_assignment']) {
        db.prepare(`DELETE FROM ${t} WHERE crew_id = ?`).run(id);
      }
      db.prepare('DELETE FROM crew_member WHERE id = ?').run(id);
      // Remove the person's own missions (SIM-xxx) once nobody else is assigned.
      for (const m of missions) {
        const used = db.prepare(
          `SELECT 1 FROM crew_assignment WHERE mission_id = ?1
           UNION SELECT 1 FROM test_session WHERE mission_id = ?1
           UNION SELECT 1 FROM vitals_reading WHERE mission_id = ?1 LIMIT 1`,
        ).get(m);
        if (!used) db.prepare('DELETE FROM mission WHERE id = ?').run(m);
      }
    });
    res.status(204).end();
  });

  // --- dashboard data -----------------------------------------------------------
  // One request returns everything the Overview, Vitals, Fitness and ECG tabs need.
  // In-flight vitals belong to one mission (?mission=<id>, default: the latest one);
  // fitness tests and ECGs are returned for the person's whole history.
  api.get('/crew/:id/dashboard', (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM crew_member WHERE id = ?').get(id);
    if (!c) return res.status(404).json({ error: 'No such crew member.' });

    const missions = plain(db.prepare(
      `SELECT m.id, m.name, m.launch_date, m.return_date, a.role
       FROM crew_assignment a JOIN mission m ON m.id = a.mission_id
       WHERE a.crew_id = ? ORDER BY m.launch_date DESC`,
    ).all(id));
    const missionId = Number(req.query.mission) || missions[0]?.id || null;

    const vitals = missionId ? plain(db.prepare(
      `SELECT id, measured_at, flight_day, systolic_mmhg, diastolic_mmhg, heart_rate_bpm,
              resp_rate_bpm, skin_temp_c, spo2_pct
       FROM vitals_reading WHERE crew_id = ? AND mission_id = ? ORDER BY measured_at`,
    ).all(id, missionId)) : [];

    const tests = plain(db.prepare(
      `SELECT s.id, s.session_date, s.position, s.location, s.status, s.mission_id, s.notes,
              sp.label, sp.phase, tc.description AS termination_reason,
              r.protocol, r.peak_watts, r.exercise_time_sec, r.vo2peak_ml_kg_min,
              r.hr_rest_bpm, r.hr_peak_bpm, r.rer_peak, r.rpe_peak, r.hr_recovery_1min
       FROM test_session s
       JOIN schedule_point sp ON sp.id = s.schedule_point_id
       JOIN cycle_test_result r ON r.session_id = s.id
       LEFT JOIN termination_criterion tc ON tc.id = s.termination_id
       WHERE s.crew_id = ? ORDER BY s.session_date`,
    ).all(id));
    // % change of VO2peak vs. the upright L-90/30 d test of the same mission
    // (the last preflight test is each person's own baseline; the supine test and
    // tests without gas analysis cannot serve as one). Rounded to one decimal.
    // The same calculation exists in SQL as the v_vo2_trend view.
    for (const t of tests) {
      const base = tests.find((b) => b.mission_id === t.mission_id && b.label === 'L-90/30 d'
        && b.position !== 'supine' && b.vo2peak_ml_kg_min);
      t.pct_vs_preflight = base && t.vo2peak_ml_kg_min && t.mission_id
        ? Math.round((1000 * (t.vo2peak_ml_kg_min - base.vo2peak_ml_kg_min)) / base.vo2peak_ml_kg_min) / 10
        : null;
    }

    const ecgs = plain(db.prepare(
      `SELECT s.session_date, sp.label, e.heart_rate_bpm, e.pr_ms, e.qrs_ms, e.qt_ms, e.qtc_ms,
              e.axis_deg, e.rhythm, e.finding, e.abnormal
       FROM ecg_result e JOIN test_session s ON s.id = e.session_id
       JOIN schedule_point sp ON sp.id = s.schedule_point_id
       WHERE s.crew_id = ? ORDER BY s.session_date`,
    ).all(id));

    const events = plain(db.prepare(
      `SELECT e.kind, e.start_flight_day, e.end_flight_day, e.description, e.source, m.name AS mission
       FROM simulated_event e LEFT JOIN mission m ON m.id = e.mission_id
       WHERE e.crew_id = ? ORDER BY e.id`,
    ).all(id));

    res.json({
      crew: {
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        sex: c.sex,
        age: ageFrom(c.birth_date),
        heightCm: c.height_cm,
        weightKg: c.weight_kg,
        agency: c.agency,
        protocol: c.cycle_protocol,
        createdInApp: c.created_in_app === 1,
      },
      missions,
      missionId,
      vitals,
      ranges: plain(db.prepare('SELECT * FROM reference_range').all()),
      tests,
      ecgs,
      events,
    });
  });

  // --- daily tasks / gamification -----------------------------------------------
  // Task list + ids ticked today + points/streak/rank/badges. Returned by both the
  // GET and the POST below, so the screen refreshes from a single response.
  const tasksPayload = (id, today) => ({
    tasks: plain(db.prepare('SELECT * FROM health_task ORDER BY sort_order').all()),
    doneToday: plain(db.prepare(
      'SELECT task_id FROM task_completion WHERE crew_id = ? AND completed_on = ?',
    ).all(id, today)).map((r) => r.task_id),
    summary: computeSummary(db, id, today),
  });

  api.get('/crew/:id/tasks', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    res.json(tasksPayload(id, localToday()));
  });

  api.post('/crew/:id/tasks/:taskId', (req, res) => {
    const id = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    if (!db.prepare('SELECT 1 FROM health_task WHERE id = ?').get(taskId)) {
      return res.status(404).json({ error: 'No such task.' });
    }
    const today = localToday();
    // Tick = insert a row, un-tick = delete it. INSERT OR IGNORE plus the UNIQUE
    // (crew, task, day) constraint makes a double click harmless.
    if (req.body?.done) {
      db.prepare(
        `INSERT OR IGNORE INTO task_completion (crew_id, task_id, completed_on, created_in_app)
         VALUES (?,?,?,1)`,
      ).run(id, taskId, today);
    } else {
      db.prepare('DELETE FROM task_completion WHERE crew_id = ? AND task_id = ? AND completed_on = ?')
        .run(id, taskId, today);
    }
    res.json(tasksPayload(id, today));
  });

  // --- psychological & cognitive assessments ------------------------------------
  const markWellbeingTask = (id) => {
    db.prepare(
      `INSERT OR IGNORE INTO task_completion (crew_id, task_id, completed_on, created_in_app)
       SELECT ?, id, ?, 1 FROM health_task WHERE code = 'wellbeing'`,
    ).run(id, localToday());
  };

  api.get('/crew/:id/wellbeing', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    res.json({
      threshold: PSYCH_THRESHOLD,
      assessments: plain(db.prepare(
        'SELECT id, taken_at, score, max_score, percent FROM psych_assessment WHERE crew_id = ? ORDER BY taken_at',
      ).all(id)),
      journal: plain(db.prepare(
        'SELECT id, written_at, text FROM journal_entry WHERE crew_id = ? ORDER BY written_at DESC',
      ).all(id)),
    });
  });

  api.post('/crew/:id/psych', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    // The browser sends only the raw answers; the score is computed here with the
    // same shared function (src/assessments.js), so it cannot be faked by the client.
    const result = scorePsych(req.body?.answers);
    if (result.error) return res.status(400).json({ error: result.error });
    // Summary row + one row per answer + the daily task: all or nothing.
    const assessmentId = transaction(db, () => {
      const aid = Number(db.prepare(
        'INSERT INTO psych_assessment (crew_id, taken_at, score, max_score, percent) VALUES (?,?,?,?,?)',
      ).run(id, nowIso(), result.score, result.max, result.percent).lastInsertRowid);
      const ins = db.prepare('INSERT INTO psych_answer VALUES (?,?,?,?,?)');
      result.items.forEach((x, i) => ins.run(aid, i + 1, x.question, x.answer, x.points));
      markWellbeingTask(id);   // counts as the daily "How do you feel?" task
      return aid;
    });
    res.status(201).json({
      id: assessmentId,
      score: result.score,
      max: result.max,
      percent: result.percent,
      belowThreshold: result.percent < PSYCH_THRESHOLD,
      items: result.items,
    });
  });

  api.post('/crew/:id/journal', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Please write something first.' });
    if (text.length > 20000) return res.status(400).json({ error: 'Journal entry is too long.' });
    db.prepare('INSERT INTO journal_entry (crew_id, written_at, text) VALUES (?,?,?)').run(id, nowIso(), text);
    res.status(201).json({ ok: true });
  });

  api.get('/crew/:id/cognitive', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    res.json(plain(db.prepare(
      `SELECT id, taken_at, test, correct, max_correct, avg_reaction_ms, false_starts, duration_sec
       FROM cognitive_result WHERE crew_id = ? ORDER BY taken_at`,
    ).all(id)));
  });

  api.post('/crew/:id/cognitive', (req, res) => {
    const id = Number(req.params.id);
    if (!crewExists(id)) return res.status(404).json({ error: 'No such crew member.' });
    const b = req.body ?? {};
    const test = testByCode(b.test);
    if (!test) {
      return res.status(400).json({ error: `Unknown test (expected ${COGNITIVE_TESTS.map((t) => t.code).join(', ')}).` });
    }
    // Unlike the questionnaire, cognitive tests run entirely in the browser (they
    // depend on timing), so the server cannot recompute them. It only checks that
    // the reported numbers are possible for the given test.
    const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
    const row = { correct: null, avg: null, falseStarts: null, duration: null };
    if (test.code === 'reaction') {
      row.avg = num(b.avgReactionMs, 50, 10000);
      row.falseStarts = num(b.falseStarts, 0, 1000);
      if (row.avg === undefined || !Number.isInteger(row.falseStarts)) {
        return res.status(400).json({ error: 'Reaction time result is invalid.' });
      }
    } else {
      row.correct = num(b.correct, 0, test.max);
      if (!Number.isInteger(row.correct)) return res.status(400).json({ error: 'Score is invalid.' });
      if (test.code === 'symbols') {
        row.duration = num(b.durationSec, 0, 600);
        if (row.duration === undefined) return res.status(400).json({ error: 'Duration is invalid.' });
      }
    }
    const details = Array.isArray(b.details) ? b.details.slice(0, 50).map(String).join('\n') : '';
    db.prepare(
      `INSERT INTO cognitive_result (crew_id, taken_at, test, correct, max_correct, avg_reaction_ms,
         false_starts, duration_sec, details) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, nowIso(), test.code, row.correct, test.code === 'reaction' ? null : test.max,
      row.avg, row.falseStarts, row.duration, details);
    res.status(201).json({ ok: true });
  });

  // --- plain-language guide -----------------------------------------------------
  api.get('/guide', (_req, res) => {
    const rows = plain(db.prepare('SELECT * FROM indicator_guide ORDER BY sort_order').all());
    res.json(rows.map((r) => ({ ...r, how_to_measure: r.how_to_measure.split('|') })));
  });

  // Satellite orbital elements from CelesTrak (cached, see satellites.js).
  // Without ?group the list of available groups is returned.
  api.get('/satellites', async (req, res) => {
    const code = req.query.group;
    if (!code) return res.json({ groups: SATELLITE_GROUPS });
    if (!SATELLITE_GROUPS.some((g) => g.code === code)) return res.status(400).json({ error: 'Unknown satellite group.' });
    try {
      res.json(await getGroup(code));
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Last resort: any error thrown in a route above ends up here as a JSON 500
  // (Express recognises an error handler by its four arguments).
  api.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return api;
}
