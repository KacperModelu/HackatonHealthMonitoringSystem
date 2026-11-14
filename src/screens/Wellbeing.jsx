import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { PSYCH_QUESTIONS, PSYCH_THRESHOLD } from '../assessments.js';

// Psychological wellbeing: questionnaire, supportive activities, journal.
export default function Wellbeing({ crewId }) {
  const [view, setView] = useState({ name: 'home' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.wellbeing(crewId).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [crewId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const home = () => { load(); setView({ name: 'home' }); };

  if (view.name === 'quiz') {
    return <Questionnaire crewId={crewId} onCancel={home} onDone={(result) => setView({ name: 'result', result })} />;
  }
  if (view.name === 'result') {
    return <Result result={view.result} onActivity={(a) => setView({ name: a, from: 'result', result: view.result })} onClose={home} />;
  }
  if (['journal', 'breathing', 'meditation'].includes(view.name)) {
    const back = () => (view.from === 'result' ? setView({ name: 'result', result: view.result }) : home());
    return (
      <section className="card activity">
        {view.name === 'journal' && <Journal crewId={crewId} />}
        {view.name === 'breathing' && <Breathing />}
        {view.name === 'meditation' && <Meditation />}
        <button onClick={back}>{view.from === 'result' ? 'Back to activities' : 'Back'}</button>
      </section>
    );
  }

  const last = data.assessments.at(-1);
  const chart = data.assessments.map((a) => ({ date: a.taken_at.slice(0, 10), percent: a.percent }));

  return (
    <>
      <section className="card">
        <h2>Psychological assessment</h2>
        <p className="muted">
          Ten short questions about stress, sleep, mood and your crew. It takes about two minutes.
          Completing it also ticks today's “How do you feel?” task.
        </p>
        {last && (
          <p>
            Last result{' '}
            <span className={`pill ${last.percent < data.threshold ? 'warning' : 'ok'}`}>{last.percent}%</span>
            <span className="muted small"> · {last.taken_at.slice(0, 10)}</span>
          </p>
        )}
        <button className="primary" onClick={() => setView({ name: 'quiz' })}>Start assessment</button>
      </section>

      {chart.length > 1 && (
        <section className="card chart-card">
          <h2>Wellbeing over time <span className="muted small">% of maximum score</span></h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#8884" vertical={false} />
              <ReferenceArea y1={0} y2={data.threshold} fill="#e0a100" fillOpacity={0.08} />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis domain={[0, 100]} fontSize={12} />
              <Tooltip formatter={(v) => [`${v}%`, 'Score']} />
              <Line dataKey="percent" stroke="#3b6fd8" strokeWidth={2} isAnimationActive={false} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      <section className="card">
        <h2>Supportive activities</h2>
        <ActivityButtons onActivity={(a) => setView({ name: a, from: 'home' })} />
      </section>

      {data.journal.length > 0 && (
        <section className="card">
          <h2>Journal <span className="muted small">private entries</span></h2>
          <ul className="journal">
            {data.journal.slice(0, 10).map((j) => (
              <li key={j.id}>
                <span className="muted small">{j.written_at.slice(0, 16).replace('T', ' ')}</span>
                <p>{j.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ActivityButtons({ onActivity }) {
  return (
    <div className="row">
      <button onClick={() => onActivity('journal')}>Journaling</button>
      <button onClick={() => onActivity('breathing')}>Breathing exercises</button>
      <button onClick={() => onActivity('meditation')}>Meditation</button>
    </div>
  );
}

// --- questionnaire -----------------------------------------------------------------
function Questionnaire({ crewId, onCancel, onDone }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState(() => PSYCH_QUESTIONS.map((q) => (q.slider ? 5 : null)));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = PSYCH_QUESTIONS[i];
  const last = i === PSYCH_QUESTIONS.length - 1;

  const set = (v) => {
    setError('');
    setAnswers(answers.map((a, k) => (k === i ? v : a)));
  };

  const next = async () => {
    if (answers[i] == null) {
      setError('Please choose an answer.');
      return;
    }
    if (!last) {
      setI(i + 1);
      return;
    }
    setBusy(true);
    try {
      onDone(await api.submitPsych(crewId, answers));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <section className="card quiz">
      <p className="muted small">Question {i + 1} of {PSYCH_QUESTIONS.length}</p>
      <div className="bar"><div style={{ width: `${(100 * i) / PSYCH_QUESTIONS.length}%` }} /></div>
      <h2 className="question">{q.text}</h2>

      {q.slider ? (
        <div className="slider">
          <input type="range" min={0} max={10} step={1} value={answers[i]}
            onChange={(e) => set(Number(e.target.value))} aria-label={q.text} />
          <div className="slider-labels">
            <span>0 = {q.low}</span>
            <strong>{answers[i]} / 10</strong>
            <span>10 = {q.high}</span>
          </div>
        </div>
      ) : (
        <div className="choices" role="radiogroup" aria-label={q.text}>
          {q.options.map((o, k) => (
            <button key={o} role="radio" aria-checked={answers[i] === k}
              className={answers[i] === k ? 'choice selected' : 'choice'} onClick={() => set(k)}>
              {o}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" onClick={next} disabled={busy}>{last ? 'Save' : 'Next'}</button>
        {i > 0 && <button onClick={() => setI(i - 1)}>Previous</button>}
        <button onClick={onCancel}>Back to assessment choice</button>
      </div>
    </section>
  );
}

function Result({ result, onActivity, onClose }) {
  return (
    <section className="card">
      <h2>Assessment completed and saved</h2>
      <p>
        Score <strong>{result.score} / {result.max}</strong>{' '}
        <span className={`pill ${result.belowThreshold ? 'warning' : 'ok'}`}>{result.percent}%</span>
      </p>
      {result.belowThreshold ? (
        <>
          <p className="act">
            Please contact your designated Earth support crew or mental-health support professional.
            Try one of the supportive activities below.
          </p>
          <h3>Choose a supportive activity</h3>
          <ActivityButtons onActivity={onActivity} />
        </>
      ) : (
        <p className="muted">Your answers are within the healthy range ({PSYCH_THRESHOLD}% or more).</p>
      )}
      <div className="row" style={{ marginTop: '1rem' }}>
        <button onClick={onClose}>Done</button>
      </div>
    </section>
  );
}

// --- supportive activities ------------------------------------------------------------
function Journal({ crewId }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);

  const save = async () => {
    try {
      await api.saveJournal(crewId, text);
      setText('');
      setMsg({ ok: true, text: 'Journal entry saved.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };

  return (
    <>
      <h2>Journaling</h2>
      <p className="muted">Take some time to reflect.</p>
      <ol>
        <li>What am I feeling right now?</li>
        <li>What has been troubling me today?</li>
        <li>Which things are within my control?</li>
        <li>What do I need from myself or my crew?</li>
        <li>What is one positive thing that happened today?</li>
      </ol>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }}
        placeholder="Write your thoughts here..." rows={7} aria-label="Journal entry" />
      {msg && <p className={msg.ok ? 'pill ok' : 'error'}>{msg.text}</p>}
      <div className="row"><button className="primary" onClick={save}>Save journal</button></div>
    </>
  );
}

const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 660;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch { /* no audio available */ }
}

// Countdown driven by wall-clock time; returns elapsed ms (null before start).
function useCountdown(durationMs) {
  const [elapsed, setElapsed] = useState(null);
  const start = useRef(0);
  useEffect(() => {
    if (elapsed === null || elapsed >= durationMs) return undefined;
    const t = setTimeout(() => {
      const e = Math.min(performance.now() - start.current, durationMs);
      setElapsed(e);
      if (e >= durationMs) beep();
    }, 200);
    return () => clearTimeout(t);
  }, [elapsed, durationMs]);
  return [elapsed, () => { start.current = performance.now(); setElapsed(0); }];
}

function Breathing() {
  const duration = 180000;
  const [elapsed, startTimer] = useCountdown(duration);
  const running = elapsed !== null && elapsed < duration;
  const done = elapsed !== null && elapsed >= duration;

  // 4 s inhale, 4 s hold, 6 s exhale, 2 s pause.
  let phase = null;
  if (running) {
    const s = Math.floor(elapsed / 1000) % 16;
    phase = s < 4 ? ['Breathe IN through your nose', 4 - s, 'in']
      : s < 8 ? ['HOLD your breath', 8 - s, 'hold']
        : s < 14 ? ['Breathe OUT through your mouth', 14 - s, 'out']
          : ['PAUSE', 16 - s, 'pause'];
  }

  return (
    <>
      <h2>Breathing exercises – 3 minutes</h2>
      <p className="muted">Sit comfortably and relax. Repeat for 3 minutes:</p>
      <ol>
        <li>Breathe in through your nose: 4 seconds.</li>
        <li>Hold gently: 4 seconds.</li>
        <li>Breathe out through your mouth: 6 seconds.</li>
        <li>Pause: 2 seconds.</li>
      </ol>
      <div className="timer" aria-live="polite">
        {running && (
          <>
            <div className={`breath ${phase[2]}`} aria-hidden="true" />
            <strong>{phase[0]}</strong>
            <span>{phase[1]} seconds</span>
          </>
        )}
        {done && <strong>Completed!</strong>}
        <span className="muted">Time left: {fmtTime(Math.ceil((duration - (elapsed ?? 0)) / 1000))}</span>
      </div>
      <div className="row">
        <button className="primary" onClick={startTimer} disabled={running}>
          {done ? 'Start again' : 'Start breathing'}
        </button>
      </div>
    </>
  );
}

function Meditation() {
  const duration = 300000;
  const [elapsed, startTimer] = useCountdown(duration);
  const running = elapsed !== null && elapsed < duration;
  const done = elapsed !== null && elapsed >= duration;
  return (
    <>
      <h2>Meditation – 5 minutes</h2>
      <p className="muted">
        Imagine yourself in a calm, peaceful state. Quiet your mind. Allow thoughts to pass without trying to
        follow them. Breathe calmly and naturally. When ready, close your eyes and start the timer.
        A tone will sound when time is up.
      </p>
      <div className="timer" aria-live="polite">
        {done ? <strong>Completed!</strong> : <strong>{running ? 'Meditation' : 'Ready'}</strong>}
        <span className="muted">Time left: {fmtTime(Math.ceil((duration - (elapsed ?? 0)) / 1000))}</span>
      </div>
      <div className="row">
        <button className="primary" onClick={startTimer} disabled={running}>
          {done ? 'Start again' : 'Start meditation'}
        </button>
      </div>
    </>
  );
}
