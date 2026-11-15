import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api.js';
import { go } from '../router.js';
import { PARAMS, STATUS_TEXT, classify, ecgLimits, fitnessStatus, fmt, rangeMap } from '../vitals.js';
import Tasks from './Tasks.jsx';
import Guide from './Guide.jsx';
import Wellbeing from './Wellbeing.jsx';
import Cognitive from './Cognitive.jsx';
import BodyMap from './BodyMap.jsx';

const TABS = ['Overview', 'Vitals', 'Fitness', 'ECG', 'Wellbeing', 'Cognitive', 'Daily tasks', 'Guide'];

// Health dashboard of one crew member.
// The medical data of the first four tabs comes from one request (/dashboard) and is
// handed down as `data`. Wellbeing, Cognitive, Daily tasks and Guide load their own
// data when their tab is opened.
export default function Dashboard({ crewId }) {
  const [tab, setTab] = useState('Overview');
  const [missionId, setMissionId] = useState(null);   // null = the latest mission (chosen by the server)
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Reload when the person or the selected mission changes.
  useEffect(() => {
    api.dashboard(crewId, missionId).then(setData).catch((e) => setError(e.message));
  }, [crewId, missionId]);

  if (error) {
    return (
      <main className="center-screen">
        <section className="card">
          <p className="error">{error}</p>
          <button onClick={() => go('/')}>Back</button>
        </section>
      </main>
    );
  }
  if (!data) return <main className="center-screen"><p className="muted">Loading…</p></main>;

  const { crew, missions } = data;
  const mission = missions.find((m) => m.id === data.missionId);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <h1>{crew.name}</h1>
          <p className="muted small">
            {crew.age} years · {crew.sex === 'F' ? 'Woman' : 'Man'}
            {crew.heightCm ? ` · ${fmt(crew.heightCm)} cm` : ''}
            {crew.weightKg ? ` · ${fmt(crew.weightKg, 1)} kg` : ''}
            {crew.agency ? ` · ${crew.agency}` : ''}
            {crew.createdInApp ? ' · generated in app' : ''}
          </p>
        </div>
        <div className="row">
          {missions.length > 1 && (
            <select
              aria-label="Mission"
              value={data.missionId ?? ''}
              onChange={(e) => setMissionId(Number(e.target.value))}
            >
              {missions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <button onClick={() => go(`/?selected=${crew.id}`)}>Log out</button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="content">
        {tab === 'Overview' && <Overview data={data} mission={mission} openTab={setTab} />}
        {tab === 'Vitals' && <Vitals data={data} mission={mission} />}
        {tab === 'Fitness' && <Fitness tests={data.tests} />}
        {tab === 'ECG' && <Ecg ecgs={data.ecgs} sex={crew.sex} />}
        {tab === 'Wellbeing' && <Wellbeing crewId={crew.id} />}
        {tab === 'Cognitive' && <Cognitive crewId={crew.id} />}
        {tab === 'Daily tasks' && <Tasks crewId={crew.id} />}
        {tab === 'Guide' && <Guide />}
      </div>
    </div>
  );
}

// --- Overview ----------------------------------------------------------------------
// "Where do I stand?" on one screen: the body map, one tile per vital sign for the
// latest reading, and short fitness / ECG summaries. Tiles and body parts are buttons
// that open the tab with the details.
function Overview({ data, mission, openTab }) {
  const [taskData, setTaskData] = useState(null);
  const [taskError, setTaskError] = useState('');
  const ranges = rangeMap(data.ranges);
  const last = data.vitals.at(-1);                  // latest in-flight reading (rows are sorted by time)
  // Counting alerts walks every reading of the mission; useMemo repeats it only when the data changes.
  const alerts = useMemo(() => countAlerts(data.vitals, ranges), [data.vitals]);
  const lastTest = [...data.tests].reverse().find((t) => t.vo2peak_ml_kg_min);   // latest test that measured VO2
  const abnormalEcg = data.ecgs.filter((e) => e.abnormal);

  useEffect(() => {
    api.tasks(data.crew.id).then(setTaskData).catch((e) => setTaskError(e.message));
  }, [data.crew.id]);

  const pendingTasks = taskData?.tasks.filter((task) => !taskData.doneToday.includes(task.id)) ?? [];

  return (
    <>
      {mission ? (
        <p className="muted">
          Mission <strong>{mission.name}</strong> ({mission.role}) · {mission.launch_date} → {mission.return_date}
          {' · '}{data.vitals.length} in-flight readings
        </p>
      ) : (
        <p className="muted">No mission yet: only annual fitness tests are available.</p>
      )}

      {taskError && <p className="error" role="alert">Could not load today's tasks: {taskError}</p>}
      {pendingTasks.length > 0 && (
        <section className="card task-reminder warning" role="status" aria-live="polite">
          <p>
            You have {pendingTasks.length} daily task{pendingTasks.length === 1 ? '' : 's'} left to complete today.
          </p>
          <button onClick={() => openTab('Daily tasks')}>Review today's tasks</button>
        </section>
      )}

      <BodyMap data={data} crewId={data.crew.id} openTab={openTab} />

      {last && (
        <>
          <h2>Last in-flight reading <span className="muted small">(flight day {last.flight_day})</span></h2>
          <div className="tiles">
            {PARAMS.map((p) => {
              const status = classify(last[p.key], ranges[p.key]);
              return (
                <button key={p.key} className={`tile ${status}`} onClick={() => openTab('Vitals')}>
                  <span className="tile-label">{p.label}</span>
                  <span className="tile-value">{fmt(last[p.key], p.key.endsWith('_c') || p.key.startsWith('resp') || p.key.startsWith('spo2') ? 1 : 0)} <small>{p.unit}</small></span>
                  <span className="tile-status">{STATUS_TEXT[status]}</span>
                  <span className="tile-foot">{alerts[p.key].warning + alerts[p.key].critical} out of range in mission</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="grid2 gap-lg">
        <section className="card">
          <h2>Aerobic fitness</h2>
          {lastTest ? (
            <p>
              Last VO₂peak <strong>{fmt(lastTest.vo2peak_ml_kg_min, 1)} ml/kg/min</strong> ({lastTest.label},{' '}
              {lastTest.session_date})
              {lastTest.pct_vs_preflight != null && (
                <span className={`pill ${fitnessStatus(lastTest.pct_vs_preflight)}`}>
                  {lastTest.pct_vs_preflight > 0 ? '+' : ''}{lastTest.pct_vs_preflight}% vs preflight
                </span>
              )}
            </p>
          ) : <p className="muted">No cycle test with gas analysis.</p>}
          {data.tests.some((t) => t.status === 'terminated') && (
            <p className="pill critical">A cycle test was stopped early. See Fitness.</p>
          )}
        </section>
        <section className="card">
          <h2>Resting ECG</h2>
          {abnormalEcg.length === 0
            ? <p className="pill ok">{data.ecgs.length ? 'All ECGs normal' : 'No ECG yet'}</p>
            : abnormalEcg.map((e) => (
              <p key={e.session_date} className="pill warning">{e.label} ({e.session_date}): {e.finding}</p>
            ))}
        </section>
      </div>

      {data.events.length > 0 && (
        <section className="card">
          <h2>Simulated deviations <span className="muted small">(ground truth for checking the analysis)</span></h2>
          <ul className="events">
            {data.events.map((e, i) => (
              <li key={i}>
                {e.description}
                {e.start_flight_day && (
                  <span className="muted"> · {e.mission}, flight days {e.start_flight_day}–{e.end_flight_day}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// For each vital sign: how many readings of the mission were amber and how many red.
function countAlerts(vitals, ranges) {
  const out = Object.fromEntries(PARAMS.map((p) => [p.key, { warning: 0, critical: 0 }]));
  for (const v of vitals) {
    for (const p of PARAMS) {
      const s = classify(v[p.key], ranges[p.key]);
      if (s === 'warning' || s === 'critical') out[p.key][s]++;
    }
  }
  return out;
}

// --- Vitals charts -------------------------------------------------------------------
const CHARTS = [
  { title: 'Blood pressure', unit: 'mmHg', lines: ['systolic_mmhg', 'diastolic_mmhg'] },
  { title: 'Resting heart rate', unit: 'bpm', lines: ['heart_rate_bpm'] },
  { title: 'Respiratory rate', unit: 'breaths/min', lines: ['resp_rate_bpm'] },
  { title: 'Skin temperature', unit: '°C', lines: ['skin_temp_c'] },
  { title: 'Blood oxygen (SpO₂)', unit: '%', lines: ['spo2_pct'] },
];
const COLORS = ['#3b6fd8', '#8a5cd6'];

function Vitals({ data, mission }) {
  const ranges = rangeMap(data.ranges);
  const [days, setDays] = useState(0);   // 0 = whole mission
  if (!data.vitals.length) return <p className="muted">No in-flight vitals for this person.</p>;

  // Keep only the chosen number of last days. x = flight day, with +0.5 for the
  // evening reading, so the two readings of one day are drawn side by side.
  const maxDay = data.vitals.at(-1).flight_day;
  const rows = data.vitals
    .filter((v) => !days || v.flight_day > maxDay - days)
    .map((v) => ({ ...v, x: v.flight_day + (v.measured_at.slice(11, 13) >= '12' ? 0.5 : 0) }));

  return (
    <>
      <div className="row between">
        <p className="muted">
          {mission?.name}: two readings a day. The <span className="band-key" /> band is the normal range;
          dots are coloured green / amber / red.
        </p>
        <div className="segmented" role="group" aria-label="Time range">
          {[[0, 'Whole mission'], [30, '30 days'], [7, '7 days']].map(([d, label]) => (
            <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="charts">
        {CHARTS.map((c) => (
          <section key={c.title} className="card chart-card">
            <h2>{c.title} <span className="muted small">{c.unit}</span></h2>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#8884" vertical={false} />
                {c.lines.map((key, i) => {
                  const r = ranges[key];
                  return r && (
                    <ReferenceArea key={`band-${key}`} y1={r.normal_low} y2={r.normal_high}
                      fill={i ? '#2e9d5b' : '#2e9d5b'} fillOpacity={0.1} ifOverflow="extendDomain" />
                  );
                })}
                <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickCount={8}
                  tickFormatter={(d) => `FD ${Math.floor(d)}`} fontSize={12} />
                <YAxis domain={['auto', 'auto']} fontSize={12} />
                <Tooltip
                  labelFormatter={(x) => `Flight day ${Math.floor(x)}${x % 1 ? ' (evening)' : ' (morning)'}`}
                  formatter={(v, name) => [`${v} ${c.unit}`, PARAMS.find((p) => p.key === name)?.label ?? name]}
                />
                {c.lines.length > 1 && (
                  <Legend formatter={(name) => PARAMS.find((p) => p.key === name)?.label ?? name} />
                )}
                {c.lines.map((key, i) => (
                  <Line key={key} dataKey={key} stroke={COLORS[i]} strokeWidth={1.5} isAnimationActive={false}
                    dot={<StatusDot range={ranges[key]} dataKey={key} />} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </section>
        ))}
      </div>
    </>
  );
}

// Custom chart point: normal readings are tiny green dots, so that amber and red
// ones (drawn larger, with a white outline) stand out along the line.
const DOT = { ok: '#2e9d5b', warning: '#e0a100', critical: '#d64545' };
function StatusDot({ cx, cy, payload, range, dataKey }) {
  if (cx == null || cy == null) return null;
  const s = classify(payload[dataKey], range);
  if (s === 'ok') return <circle cx={cx} cy={cy} r={1.6} fill={DOT.ok} />;
  return <circle cx={cx} cy={cy} r={s === 'critical' ? 4 : 3} fill={DOT[s]} stroke="#fff" strokeWidth={1} />;
}

// --- Fitness (N3.07 cycle ergometer) -------------------------------------------
function Fitness({ tests }) {
  if (!tests.length) return <p className="muted">No cycle ergometer tests.</p>;
  // The chart shows only tests that can be compared: with gas analysis and not supine
  // (lying down gives a lower VO2peak for the same fitness). The table lists them all.
  const chart = tests
    .filter((t) => t.vo2peak_ml_kg_min && t.position !== 'supine')
    .map((t) => ({ name: t.label, date: t.session_date, vo2: t.vo2peak_ml_kg_min, hr: t.hr_peak_bpm }));

  return (
    <>
      <section className="card chart-card">
        <h2>VO₂peak over time <span className="muted small">ml/kg/min, upright tests</span></h2>
        <p className="muted small">
          Aerobic fitness usually drops in the first weeks of flight and recovers within a month after landing.
          A drop of more than 10% from preflight is marked amber, more than 20% red.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#8884" vertical={false} />
            <XAxis dataKey="name" fontSize={12} interval={0} />
            <YAxis domain={['auto', 'auto']} fontSize={12} />
            <Tooltip labelFormatter={(n, p) => `${n} · ${p?.[0]?.payload.date ?? ''}`}
              formatter={(v) => [`${v} ml/kg/min`, 'VO₂peak']} />
            <Line dataKey="vo2" stroke={COLORS[0]} strokeWidth={2} isAnimationActive={false} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Test</th><th>Date</th><th>Where</th><th>VO₂peak</th><th>vs preflight</th>
              <th>Peak W</th><th>HR rest / peak</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => {
              // Same rule as on the Overview and the body map (see fitnessStatus).
              const pct = t.pct_vs_preflight;
              const s = fitnessStatus(pct);
              return (
                <tr key={t.id}>
                  <td>{t.label}{t.position === 'supine' ? ' (supine)' : ''}</td>
                  <td>{t.session_date}</td>
                  <td>{t.location}</td>
                  <td>{t.vo2peak_ml_kg_min ?? <span className="muted">no gas analysis</span>}</td>
                  <td>{pct == null ? '–' : <span className={`pill ${s}`}>{pct > 0 ? '+' : ''}{pct}%</span>}</td>
                  <td>{t.peak_watts}</td>
                  <td>{t.hr_rest_bpm} / {t.hr_peak_bpm}</td>
                  <td>
                    {t.status === 'completed' ? 'Completed'
                      : <span className="pill critical" title={t.notes ?? ''}>{t.status === 'terminated' ? 'Stopped' : 'Repeat'}: {t.termination_reason ?? t.notes}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

// --- ECG (MEDB 1.6) ------------------------------------------------------------
function Ecg({ ecgs, sex }) {
  if (!ecgs.length) return <p className="muted">No resting ECG recorded.</p>;
  // Normal ranges of the ECG intervals in ms; the QTc limit depends on sex.
  const limit = ecgLimits(sex);
  const cell = (key, v) => {
    const [lo, hi] = limit[key];
    return <span className={`pill ${v < lo || v > hi ? 'warning' : 'ok'}`}>{v} ms</span>;
  };
  return (
    <section className="card table-card">
      <p className="muted small">
        12-lead resting ECG before and after flight. Normal ranges: PR 120–200 ms, QRS 70–110 ms, QTc 350–450 ms
        (up to 460 ms in women).
      </p>
      <table>
        <thead>
          <tr><th>Test</th><th>Date</th><th>HR</th><th>PR</th><th>QRS</th><th>QTc</th><th>Rhythm</th><th>Finding</th></tr>
        </thead>
        <tbody>
          {ecgs.map((e) => (
            <tr key={e.session_date + e.label}>
              <td>{e.label}</td>
              <td>{e.session_date}</td>
              <td>{e.heart_rate_bpm} bpm</td>
              <td>{cell('pr_ms', e.pr_ms)}</td>
              <td>{cell('qrs_ms', e.qrs_ms)}</td>
              <td>{cell('qtc_ms', e.qtc_ms)}</td>
              <td>{e.rhythm}</td>
              <td>{e.abnormal ? <span className="pill warning">{e.finding}</span> : e.finding}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
