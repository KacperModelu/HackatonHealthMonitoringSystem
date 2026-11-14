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
  assert.equal((await call('POST', '/crew', { firstName: 'A', lastName: 'B', age: 30, heightCm: '300' })).status, 400);
});

test('generate, read dashboard, tick a task, delete', async () => {
  const created = await call('POST', '/crew', {
    firstName: 'Test', lastName: 'Pilot', age: '41', sex: 'F', heightCm: '', weightKg: '58,5',
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
  assert.equal(dash.crew.protocol, 'light');
  assert.equal(dash.events.length, r.events.length);
  assert.equal(dash.tests.find((t) => t.label === 'L-90/30 d' && t.position === 'upright').pct_vs_preflight, 0);

  const tasks = (await call('GET', `/crew/${r.crewId}/tasks`)).body;
  assert.equal(tasks.summary.todayPoints, 0);
  const ticked = (await call('POST', `/crew/${r.crewId}/tasks/${tasks.tasks[0].id}`, { done: true })).body;
  assert.equal(ticked.summary.todayPoints, tasks.tasks[0].points);
  assert.deepEqual(ticked.doneToday, [tasks.tasks[0].id]);
  assert.equal(ticked.summary.currentStreak, 1);

  assert.equal((await call('DELETE', `/crew/${r.crewId}`)).status, 204);
  for (const t of ['crew_member WHERE id', 'vitals_reading WHERE crew_id', 'test_session WHERE crew_id',
    'task_completion WHERE crew_id', 'simulated_event WHERE crew_id']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} = ?`).get(r.crewId).n, 0, t);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mission WHERE name = ?').get(r.mission).n, 0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('reference crew cannot be deleted', async () => {
  assert.equal((await call('DELETE', '/crew/1')).status, 403);
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
