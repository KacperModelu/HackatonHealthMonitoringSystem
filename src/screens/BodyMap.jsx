import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PSYCH_THRESHOLD } from '../assessments.js';
import { STATUS_TEXT, classify, fitnessStatus, fmt, rangeMap } from '../vitals.js';

// Human silhouette coloured by body system, using the latest data of each kind:
//   brain ← wellbeing questionnaire, heart ← HR / BP / ECG, lungs ← resp. rate / SpO2,
//   skin (head, torso, arms) ← skin temperature, legs ← aerobic fitness (VO2peak).
const RANK = { none: 0, ok: 1, warning: 2, critical: 3 };
const worst = (...s) => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'none');

function regions(data, psych) {
  const ranges = rangeMap(data.ranges);
  const last = data.vitals.at(-1);
  const st = (key) => (last ? classify(last[key], ranges[key]) : 'none');

  const lastEcg = data.ecgs.at(-1);
  const ecgStatus = lastEcg ? (lastEcg.abnormal ? 'warning' : 'ok') : 'none';
  const heart = worst(st('heart_rate_bpm'), st('systolic_mmhg'), st('diastolic_mmhg'), ecgStatus);
  const heartBits = [];
  if (last) {
    heartBits.push(`HR ${fmt(last.heart_rate_bpm)} bpm`, `BP ${fmt(last.systolic_mmhg)}/${fmt(last.diastolic_mmhg)} mmHg`);
  }
  if (lastEcg) heartBits.push(lastEcg.abnormal ? `ECG: ${lastEcg.finding}` : 'ECG normal');

  const fit = [...data.tests].reverse().find((t) => t.pct_vs_preflight != null);
  const lastTest = data.tests.at(-1);
  const fitStatus = fitnessStatus(fit?.pct_vs_preflight);
  const stopped = lastTest && lastTest.status === 'terminated';
  const legBits = [];
  if (fit) legBits.push(`VO₂peak ${fit.pct_vs_preflight > 0 ? '+' : ''}${fit.pct_vs_preflight}% vs preflight (${fit.label})`);
  if (stopped) legBits.push('last cycle test stopped early');

  const lastPsych = psych?.at(-1);
  const brain = lastPsych
    ? (lastPsych.percent < PSYCH_THRESHOLD ? 'warning' : 'ok')
    : 'none';

  return [
    {
      id: 'brain', label: 'Brain & mood', tab: 'Wellbeing', status: brain,
      detail: lastPsych ? `Wellbeing score ${Math.round(lastPsych.percent)}%` : 'No questionnaire yet',
    },
    {
      id: 'heart', label: 'Heart & circulation', tab: 'Vitals', status: heart,
      detail: heartBits.join(' · ') || 'No data',
    },
    {
      id: 'lungs', label: 'Lungs & breathing', tab: 'Vitals',
      status: worst(st('resp_rate_bpm'), st('spo2_pct')),
      detail: last ? `Resp. ${fmt(last.resp_rate_bpm, 1)} /min · SpO₂ ${fmt(last.spo2_pct, 1)}%` : 'No data',
    },
    {
      id: 'skin', label: 'Skin & temperature', tab: 'Vitals', status: st('skin_temp_c'),
      detail: last ? `Skin temperature ${fmt(last.skin_temp_c, 1)} °C` : 'No data',
    },
    {
      id: 'legs', label: 'Muscles & fitness', tab: 'Fitness',
      status: worst(fitStatus, stopped ? 'critical' : 'none'),
      detail: legBits.join(' · ') || 'No fitness test with gas analysis',
    },
  ];
}

// Mirror a left-side path onto the right side of the 200-wide drawing.
const MIRROR = 'translate(200 0) scale(-1 1)';
const ARM = 'M62 88 Q44 90 40 112 L28 198 Q25 214 34 217 Q43 219 45 204 L60 132 Z';
const LEG = 'M71 222 L99 222 L97 330 L95 408 Q95 420 85 420 L74 420 Q67 420 68 409 L69 330 Z';
const LUNG = 'M96 98 Q78 94 72 116 Q65 150 72 168 Q86 172 96 160 Z';

export default function BodyMap({ data, crewId, openTab }) {
  const [psych, setPsych] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    api.wellbeing(crewId).then((w) => setPsych(w.assessments)).catch(() => setPsych([]));
  }, [crewId]);

  const list = regions(data, psych);
  const by = Object.fromEntries(list.map((r) => [r.id, r]));
  const part = (id, layer) => ({
    className: `body-part ${layer} s-${by[id].status}${hover === id ? ' hot' : ''}`,
    onClick: () => openTab(by[id].tab),
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
  });
  const last = data.vitals.at(-1);

  return (
    <section className="card body-card">
      <div className="body-figure">
        <svg viewBox="0 0 200 430" aria-hidden="true">
          {/* skin layer */}
          <g {...part('skin', 'base')}>
            <circle cx="100" cy="40" r="28" />
            <rect x="89" y="64" width="22" height="18" rx="5" />
            <path d="M62 84 Q100 74 138 84 L146 150 Q142 200 132 224 L68 224 Q58 200 54 150 Z" />
            <path d={ARM} />
            <path d={ARM} transform={MIRROR} />
          </g>
          <g {...part('legs', 'base')}>
            <path d={LEG} />
            <path d={LEG} transform={MIRROR} />
          </g>
          {/* organs */}
          <g {...part('brain', 'organ')}><ellipse cx="100" cy="34" rx="19" ry="14" /></g>
          <g {...part('lungs', 'organ')}>
            <path d={LUNG} />
            <path d={LUNG} transform={MIRROR} />
          </g>
          <g {...part('heart', 'organ')}>
            <path d="M110 128 c-6 -8 -19 -4 -17 6 c2 9 17 19 17 19 c0 0 15 -10 17 -19 c2 -10 -11 -14 -17 -6 Z" />
          </g>
        </svg>
      </div>

      <div className="body-legend">
        <h2>Body status</h2>
        <p className="muted small">
          {last ? `Latest reading, flight day ${last.flight_day}. ` : ''}
          Click a body part to see the details.
        </p>
        <ul>
          {list.map((r) => (
            <li key={r.id}>
              <button
                className={`body-row${hover === r.id ? ' hot' : ''}`}
                onClick={() => openTab(r.tab)}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(r.id)}
                onBlur={() => setHover(null)}
              >
                <span className={`body-dot s-${r.status}`} aria-hidden="true" />
                <span className="body-text">
                  <strong>{r.label}</strong>
                  <span className="muted small">{r.detail}</span>
                </span>
                <span className={`pill ${r.status === 'none' ? 'neutral' : r.status}`}>{STATUS_TEXT[r.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
