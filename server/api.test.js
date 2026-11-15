// Run with: npm test   (works on a temporary copy of the database)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { defaultDbPath, openDb } from './db.js';
import { createApi } from './api.js';
import { generate } from './generator.js';
import { seedOutliers } from './seed-outliers.js';
import { classify, rangeMap } from '../src/vitals.js';

let dir;
let db;
let server;
let base;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cardio-'));
  const file = path.join(dir, 'cardio.db');
  copyFileSync(defaultDbPath, file);
  db = openDb(file);
  const app = express();
  app.use('/api', createApi(db));
  server = app.listen(0);
  // One test generates 40 people synchronously and blocks the event loop for a few
  // seconds. With the default 5 s keep-alive the idle connection could be closed
  // meanwhile and the next request would fail with ECONNRESET on a slow machine.
  server.keepAliveTimeout = 120000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('form validation rejects bad input', async () => {
  assert.equal((await call('POST', '/crew', { firstName: '', lastName: 'X', age: 30 })).status, 400);
  assert.equal((await call('POST', '/crew', { firstName: 'A', lastName: 'B', age: 12 })).status, 400);
  const full = { firstName: 'A', lastName: 'B', age: '30', sex: 'M', heightCm: '180', weightKg: '80' };
  assert.equal((await call('POST', '/crew', { ...full, heightCm: '300' })).status, 400);
  // Every field is required, and the response names the missing ones
  const missing = await call('POST', '/crew', { firstName: 'A', lastName: 'B', age: '30' });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.fields, ['sex', 'heightCm', 'weightKg']);
  assert.equal((await call('POST', '/crew', { ...full, sex: 'X' })).status, 400);
  assert.equal((await call('POST', '/crew', { ...full, weightKg: '  ' })).status, 400);
});

test('generate, read dashboard, tick a task, delete', async () => {
  const created = await call('POST', '/crew', {
    firstName: 'Test', lastName: 'Pilot', age: '41', sex: 'F', heightCm: '165', weightKg: '58,5',
  });
  assert.equal(created.status, 201);
  const r = created.body;
  assert.match(r.mission, /^SIM-\d{3}$/);
  assert.ok(r.vitalsReadings >= 300 && r.cycleTests >= 8 && r.ecgs === 2);

  const list = await call('GET', '/crew');
  const me = list.body.find((c) => c.id === r.crewId);
  assert.equal(me.name, 'Test Pilot');
  assert.ok(me.createdInApp);

  const dash = (await call('GET', `/crew/${r.crewId}/dashboard`)).body;
  assert.equal(dash.vitals.length, r.vitalsReadings);
  assert.equal(dash.tests.length, r.cycleTests);
  assert.equal(dash.crew.weightKg, 58.5);
  assert.equal(dash.crew.heightCm, 165);
  assert.equal(dash.crew.protocol, 'light');
  assert.equal(dash.events.length, r.events.length);
  assert.equal(dash.tests.find((t) => t.label === 'L-90/30 d' && t.position === 'upright').pct_vs_preflight, 0);

  const history = db.prepare(
    'SELECT COUNT(*) AS n FROM task_completion WHERE crew_id = ?',
  ).get(r.crewId).n;
  assert.ok(history > 0);
  assert.equal(history, r.taskCompletions);

  const tasks = (await call('GET', `/crew/${r.crewId}/tasks`)).body;
  const task = tasks.tasks[0];
  if (tasks.doneToday.includes(task.id)) {
    await call('POST', `/crew/${r.crewId}/tasks/${task.id}`, { done: false });
  }
  const beforeTick = (await call('GET', `/crew/${r.crewId}/tasks`)).body;
  const ticked = (await call('POST', `/crew/${r.crewId}/tasks/${task.id}`, { done: true })).body;
  assert.equal(ticked.summary.todayPoints, beforeTick.summary.todayPoints + task.points);
  assert.ok(ticked.doneToday.includes(task.id));
  assert.ok(ticked.summary.currentStreak >= 1);

  assert.equal((await call('DELETE', `/crew/${r.crewId}`)).status, 204);
  for (const t of ['crew_member WHERE id', 'vitals_reading WHERE crew_id', 'test_session WHERE crew_id',
    'task_completion WHERE crew_id', 'simulated_event WHERE crew_id']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} = ?`).get(r.crewId).n, 0, t);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mission WHERE name = ?').get(r.mission).n, 0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('generated task history spans launch through today and severe scenarios are random', () => {
  const today = '2025-01-31';
  const person = { firstName: 'History', lastName: 'Test', age: 35, sex: 'F', heightCm: 165, weightKg: 60 };
  const severe = generate(db, person, { today, rand: () => 0 });
  assert.equal(severe.severeOutlier, true);
  assert.ok(severe.events.some((event) => event.text.startsWith('SEVERE – ')));

  const mission = db.prepare('SELECT launch_date FROM mission WHERE name = ?').get(severe.mission);
  const taskCount = db.prepare('SELECT COUNT(*) AS n FROM health_task').get().n;
  const history = db.prepare(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT completed_on) AS days,
            MIN(completed_on) AS firstDay, MAX(completed_on) AS lastDay
     FROM task_completion WHERE crew_id = ?`,
  ).get(severe.crewId);
  const expectedDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mission.launch_date}T00:00:00Z`))
    / 86400000 + 1;
  assert.equal(history.firstDay, mission.launch_date);
  assert.equal(history.lastDay, today);
  assert.equal(history.days, expectedDays);
  assert.equal(history.n, taskCount * expectedDays);
  assert.equal(history.n, severe.taskCompletions);
  assert.deepEqual(db.prepare(
    'SELECT DISTINCT created_in_app FROM task_completion WHERE crew_id = ?',
  ).all(severe.crewId).map((row) => row.created_in_app), [0]);

  const usual = generate(db, { ...person, lastName: 'Usual' }, { today, rand: () => 0.5 });
  assert.equal(usual.severeOutlier, false);
  assert.ok(!usual.events.some((event) => event.text.startsWith('SEVERE – ')));
});

test('preloaded crew are hidden and their data is blocked', async () => {
  const list = (await call('GET', '/crew')).body;
  assert.ok(list.every((c) => c.createdInApp));
  for (const p of ['dashboard', 'tasks', 'wellbeing', 'cognitive']) {
    assert.equal((await call('GET', `/crew/1/${p}`)).status, 403, p);
  }
  assert.equal((await call('POST', '/crew/1/journal', { text: 'x' })).status, 403);
});

test('any profile can be deleted, including preloaded crew', async () => {
  assert.equal((await call('DELETE', '/crew/1')).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crew_member WHERE id = 1').get().n, 0);
  for (const t of ['vitals_reading', 'test_session', 'crew_assignment']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE crew_id = 1`).get().n, 0, t);
  }
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal((await call('DELETE', '/crew/1')).status, 404);
});

test('generated data is varied and deviations show up as alerts', () => {
  const kinds = {};
  let healthyAlerts = 0;
  let healthyRows = 0;
  for (let i = 0; i < 40; i++) {
    const r = generate(db, { firstName: 'Bulk', lastName: String(i), age: 25 + i, sex: i % 2 ? 'F' : 'M' });
    for (const e of r.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    if (!r.events.length) {
      healthyRows += r.vitalsReadings;
      healthyAlerts += db.prepare(
        `SELECT COUNT(DISTINCT a.id) n FROM v_vitals_alerts a JOIN vitals_reading v ON v.id = a.id
         WHERE v.crew_id = ?`).get(r.crewId).n;
    }
    for (const e of r.events.filter((x) => ['hypertension', 'desaturation', 'tachycardia'].includes(x.kind))) {
      const inWindow = db.prepare(
        `SELECT COUNT(*) n FROM vitals_reading WHERE crew_id = ? AND flight_day BETWEEN ? AND ?`,
      ).get(r.crewId, e.start, e.end).n;
      const flagged = db.prepare(
        `SELECT COUNT(DISTINCT a.id) n FROM v_vitals_alerts a JOIN vitals_reading v ON v.id = a.id
         WHERE v.crew_id = ? AND v.flight_day BETWEEN ? AND ?`).get(r.crewId, e.start, e.end).n;
      if (e.kind === 'hypertension') {
        // A gradual trend (+12 → +28 mmHg): how much of it crosses 130/85 depends on the
        // person's baseline, so check the size of the shift instead of the alert share.
        const avg = (w) => db.prepare(
          `SELECT AVG(systolic_mmhg) s FROM vitals_reading WHERE crew_id = ? AND ${w}`,
        ).get(r.crewId, e.start, e.end).s;
        const shift = avg('flight_day BETWEEN ? AND ?') - avg('NOT flight_day BETWEEN ? AND ?');
        assert.ok(shift > 14, `hypertension shift ${shift}`);
      } else {
        assert.ok(flagged / inWindow > 0.8, `${e.kind}: ${flagged}/${inWindow}`);
      }
    }
  }
  assert.ok(Object.keys(kinds).length >= 7, JSON.stringify(kinds));
  if (healthyRows) assert.ok(healthyAlerts / healthyRows < 0.12, `healthy ${healthyAlerts}/${healthyRows}`);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('psychological questionnaire, journal and cognitive results', async () => {
  const { crewId } = (await call('POST', '/crew', {
    firstName: 'Psy', lastName: 'Test', age: 30, sex: 'M', heightCm: 180, weightKg: 75,
  })).body;

  // Missing answer / out-of-range slider are rejected
  assert.equal((await call('POST', `/crew/${crewId}/psych`, { answers: [5, 5] })).status, 400);
  assert.equal((await call('POST', `/crew/${crewId}/psych`, { answers: [11, 5, 5, 5, 2, 5, 0, 0, 0, 5] })).status, 400);

  // Best answers: low stress/loneliness/tiredness, good sleep, 6-8 h, coping, happy, connected, practice, no stressor
  const best = await call('POST', `/crew/${crewId}/psych`, { answers: [0, 0, 0, 10, 2, 10, 1, 0, 0, 5] });
  assert.equal(best.status, 201);
  assert.equal(best.body.score, 99);              // practice question gives 9 at best
  assert.equal(best.body.max, 99);                // so the maximum is 99, not 100
  assert.equal(best.body.percent, 100);
  assert.equal(best.body.belowThreshold, false);

  // Worst answers → below the 60 % threshold
  const worst = (await call('POST', `/crew/${crewId}/psych`, { answers: [10, 10, 10, 0, 0, 0, 6, 3, 5, 2] })).body;
  assert.equal(worst.score, 0 + 0 + 0 + 0 + 0 + 0 + 1 + 2 + 3 + 1);
  assert.equal(worst.belowThreshold, true);

  // Completing the questionnaire ticks the daily "How do you feel?" task
  const tasks = (await call('GET', `/crew/${crewId}/tasks`)).body;
  const wellbeing = tasks.tasks.find((t) => t.code === 'wellbeing');
  assert.ok(tasks.doneToday.includes(wellbeing.id));

  assert.equal((await call('POST', `/crew/${crewId}/journal`, { text: '   ' })).status, 400);
  assert.equal((await call('POST', `/crew/${crewId}/journal`, { text: 'Calm day.' })).status, 201);
  const wb = (await call('GET', `/crew/${crewId}/wellbeing`)).body;
  assert.equal(wb.assessments.length, 2);
  assert.equal(wb.journal[0].text, 'Calm day.');

  assert.equal((await call('POST', `/crew/${crewId}/cognitive`, { test: 'nope' })).status, 400);
  assert.equal((await call('POST', `/crew/${crewId}/cognitive`, { test: 'memory', correct: 6 })).status, 400);
  assert.equal((await call('POST', `/crew/${crewId}/cognitive`,
    { test: 'reaction', avgReactionMs: 312.4, falseStarts: 1, details: ['Trial 1: 300 ms'] })).status, 201);
  assert.equal((await call('POST', `/crew/${crewId}/cognitive`,
    { test: 'symbols', correct: 9, durationSec: 14.2 })).status, 201);
  const cog = (await call('GET', `/crew/${crewId}/cognitive`)).body;
  assert.deepEqual(cog.map((r) => r.test), ['reaction', 'symbols']);
  assert.equal(cog[1].max_correct, 10);

  // Deleting the user removes the assessments too
  const answersBefore = db.prepare('SELECT COUNT(*) n FROM psych_answer').get().n;
  assert.equal((await call('DELETE', `/crew/${crewId}`)).status, 204);
  for (const t of ['psych_assessment', 'journal_entry', 'cognitive_result']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE crew_id = ?`).get(crewId).n, 0, t);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM psych_answer').get().n, answersBefore - 20);   // 2 × 10 answers
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('outlier profiles are visibly unhealthy in their latest data', async () => {
  // The copied database may already contain outliers: remove them so fresh ones are made.
  for (const c of (await call('GET', '/crew')).body.filter((p) => p.name.startsWith('Outlier '))) {
    assert.equal((await call('DELETE', `/crew/${c.id}`)).status, 204);
  }
  const created = seedOutliers(db);
  assert.equal(created.filter((r) => !r.skipped).length, 8);
  assert.ok(seedOutliers(db).every((r) => r.skipped));         // running again adds nothing

  const list = (await call('GET', '/crew')).body;
  const byName = (n) => list.find((c) => c.name === `Outlier ${n}`);
  for (const r of created) assert.ok(byName(r.name), r.name);  // all on the login list

  // Status of each vital sign in the latest reading of a profile.
  const latest = async (name) => {
    const d = (await call('GET', `/crew/${byName(name).id}/dashboard`)).body;
    const ranges = rangeMap(d.ranges);
    const last = d.vitals.at(-1);
    const st = (k) => classify(last[k], ranges[k]);
    return { d, st };
  };

  let x = await latest('Hypertension (severe)');
  assert.equal(x.st('systolic_mmhg'), 'critical');
  x = await latest('Hypotension + Bradycardia');
  assert.equal(x.st('systolic_mmhg'), 'critical');
  assert.equal(x.st('heart_rate_bpm'), 'critical');
  x = await latest('Fever + Tachycardia');
  assert.equal(x.st('skin_temp_c'), 'critical');
  assert.equal(x.st('heart_rate_bpm'), 'critical');
  x = await latest('Low Oxygen (SpO2) + High CO2');
  assert.equal(x.st('spo2_pct'), 'critical');
  assert.equal(x.st('resp_rate_bpm'), 'critical');
  for (const n of ['Fitness Loss + Stopped Test', 'Multi-System Failure']) {
    x = await latest(n);
    // The latest comparable test (what the body map uses) is still more than 20% down.
    const lastFit = [...x.d.tests].reverse().find((t) => t.pct_vs_preflight != null);
    assert.ok(lastFit.pct_vs_preflight < -20, `${n}: ${lastFit.pct_vs_preflight}`);
    assert.ok(x.d.tests.some((t) => t.status === 'terminated'), n);
  }
  x = await latest('Abnormal ECG (long QTc)');
  assert.ok(x.d.ecgs.at(-1).abnormal && x.d.ecgs.at(-1).qtc_ms > 460);

  const mood = (await call('GET', `/crew/${byName('Low Mood + Poor Sleep').id}/wellbeing`)).body;
  assert.ok(mood.assessments.at(-1).percent < 60);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
