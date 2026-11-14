import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { COGNITIVE_TESTS, MATRIX_QUESTIONS, SPATIAL_QUESTIONS, SYMBOLS, testByCode } from '../assessments.js';

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// setTimeout that is cancelled when the component unmounts.
function useTimeouts() {
  const ids = useRef([]);
  useEffect(() => () => ids.current.forEach(clearTimeout), []);
  return (fn, ms) => { ids.current.push(setTimeout(fn, ms)); };
}

const summaryOf = (r) => {
  if (r.test === 'reaction') {
    return `Average ${Math.round(r.avg_reaction_ms ?? r.avgReactionMs)} ms · ${r.false_starts ?? r.falseStarts} false starts`;
  }
  const correct = r.correct;
  const max = r.max_correct ?? testByCode(r.test).max;
  const time = r.duration_sec ?? r.durationSec;
  return `${correct}/${max} correct${time != null ? ` · ${Number(time).toFixed(1)} s` : ''}`;
};

// Cognitive assessment: six short tests, results saved to the database.
export default function Cognitive({ crewId }) {
  const [history, setHistory] = useState(null);
  const [test, setTest] = useState(null);       // code of the running test
  const [result, setResult] = useState(null);   // last finished result
  const [error, setError] = useState('');

  const load = () => api.cognitive(crewId).then(setHistory).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [crewId]);

  const finish = async (r) => {
    setResult(r);
    try {
      await api.saveCognitive(crewId, r);
      load();
    } catch (e) {
      setError(`Could not save results: ${e.message}`);
    }
  };

  if (test) {
    const def = testByCode(test);
    const close = () => { setTest(null); setResult(null); };
    return (
      <section className="card cog">
        <h2>{def.name}</h2>
        {result ? (
          <div className="cog-done">
            <p className="cog-display">{summaryOf(result)}</p>
            <p className="muted">Results are saved.</p>
            <button className="primary" onClick={close}>Back to test menu</button>
          </div>
        ) : (
          <TestRunner code={test} intro={def.intro} onFinish={finish} />
        )}
        {!result && <button className="link" onClick={close}>Back to test menu</button>}
      </section>
    );
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <h2>Choose a cognitive test</h2>
        <p className="muted">
          Spaceflight stress, sleep loss and high CO₂ can slow reactions and memory. Repeating these short tests
          regularly shows changes from your personal baseline.
        </p>
        <div className="cog-menu">
          {COGNITIVE_TESTS.map((t) => {
            const mine = history?.filter((h) => h.test === t.code) ?? [];
            const last = mine.at(-1);
            return (
              <button key={t.code} className="cog-item" onClick={() => { setResult(null); setTest(t.code); }}>
                <strong>{t.label}</strong>
                <span className="muted small">
                  {last ? `Last: ${summaryOf(last)} · ${last.taken_at.slice(0, 10)}` : 'Not taken yet'}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function TestRunner({ code, intro, onFinish }) {
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <>
        <p className="cog-display small-text">{intro}</p>
        <button className="primary" onClick={() => setStarted(true)}>Start</button>
      </>
    );
  }
  const Test = { reaction: Reaction, memory: Memory, two_back: TwoBack, matrix: Matrix, spatial: Spatial, symbols: Symbols }[code];
  return <Test onFinish={onFinish} />;
}

// --- reaction time ---------------------------------------------------------------
function Reaction({ onFinish }) {
  const [stage, setStage] = useState('between');   // between | waiting | ready
  const [times, setTimes] = useState([]);
  const [falseStarts, setFalseStarts] = useState(0);
  const [msg, setMsg] = useState('Press the button to start the first trial.');
  const signal = useRef(0);
  const shownAt = useRef(0);
  const later = useTimeouts();

  const nextTrial = () => {
    setStage('waiting');
    setMsg('WAIT...');
    const id = ++signal.current;
    later(() => {
      if (signal.current !== id) return;
      shownAt.current = performance.now();
      setStage('ready');
      setMsg('CLICK NOW!');
    }, randInt(1500, 3500));
  };

  const click = () => {
    if (stage === 'between') return nextTrial();
    if (stage === 'waiting') {
      signal.current++;
      setFalseStarts(falseStarts + 1);
      setStage('between');
      setMsg('Too early! Retry this trial.');
      return undefined;
    }
    const ms = Math.round(performance.now() - shownAt.current);
    const all = [...times, ms];
    setTimes(all);
    if (all.length === 5) {
      onFinish({
        test: 'reaction',
        avgReactionMs: Math.round((10 * all.reduce((s, x) => s + x, 0)) / all.length) / 10,
        falseStarts,
        details: all.map((t, i) => `Trial ${i + 1}: ${t} ms`),
      });
    } else {
      setStage('between');
      setMsg(`Reaction time: ${ms} ms`);
    }
    return undefined;
  };

  const label = stage === 'between' ? (times.length || falseStarts ? 'Next trial' : 'Start') : stage === 'waiting' ? 'Do not click yet' : 'CLICK!';
  return (
    <>
      <p className="muted small">Successful trial {Math.min(times.length + 1, 5)} of 5</p>
      <button className={`reaction ${stage}`} onPointerDown={click}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) click(); } }}>
        <span className="cog-display">{msg}</span>
        <span>{label}</span>
      </button>
    </>
  );
}

// --- digit memory -----------------------------------------------------------------
function Memory({ onFinish }) {
  const [round, setRound] = useState(0);
  const [stage, setStage] = useState('showing');   // showing | answering | between
  const [digits, setDigits] = useState('');
  const [answer, setAnswer] = useState('');
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState({ correct: 0, details: [] });
  const later = useTimeouts();

  const show = (r) => {
    const seq = Array.from({ length: r + 3 }, () => randInt(0, 9)).join('');
    setDigits(seq);
    setAnswer('');
    setStage('showing');
    later(() => setStage('answering'), 2000 + r * 400);
  };
  useEffect(() => { show(0); }, []);

  const submit = (e) => {
    e.preventDefault();
    const a = answer.trim();
    if (!a) return;
    const ok = a === digits;
    const next = {
      correct: log.correct + (ok ? 1 : 0),
      details: [...log.details, `Round ${round + 1}: sequence ${digits}; answer ${a}; ${ok ? 'correct' : 'incorrect'}`],
    };
    setLog(next);
    if (round === 4) {
      onFinish({ test: 'memory', correct: next.correct, details: next.details });
      return;
    }
    setMsg(ok ? 'Correct!' : `Incorrect. Sequence: ${digits}`);
    setStage('between');
  };

  return (
    <>
      <p className="muted small">Round {round + 1} of 5</p>
      {stage === 'showing' && <p className="cog-display big">{digits}</p>}
      {stage === 'answering' && (
        <form onSubmit={submit} className="cog-form">
          <p className="cog-display">Type the digits you just saw:</p>
          <input autoFocus inputMode="numeric" value={answer} maxLength={7}
            onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ''))} aria-label="Digits" />
          <button className="primary" type="submit">Submit</button>
        </form>
      )}
      {stage === 'between' && (
        <>
          <p className="cog-display">{msg}</p>
          <button className="primary" onClick={() => { setRound(round + 1); show(round + 1); }}>Next round</button>
        </>
      )}
    </>
  );
}

// --- 2-back working memory --------------------------------------------------------
function makeTwoBack() {
  const d = [];
  for (let i = 0; i < 12; i++) {
    let x = randInt(0, 9);
    if (i >= 2) {
      if ([3, 5, 8, 10].includes(i)) x = d[i - 2];
      else while (x === d[i - 2]) x = randInt(0, 9);
    }
    d.push(x);
  }
  return d;
}

function TwoBack({ onFinish }) {
  const [digits] = useState(makeTwoBack);
  const [round, setRound] = useState(0);
  const [stage, setStage] = useState('showing');   // showing | gap | answering
  const [log, setLog] = useState({ correct: 0, details: [] });
  const later = useTimeouts();

  useEffect(() => {
    setStage('showing');
    later(() => {
      if (round < 2) {
        setStage('gap');
        later(() => setRound((r) => r + 1), 450);
      } else {
        setStage('answering');
      }
    }, 900);
  }, [round]);

  const answer = (same) => {
    if (stage !== 'answering') return;
    const match = digits[round] === digits[round - 2];
    const ok = same === match;
    const next = {
      correct: log.correct + (ok ? 1 : 0),
      details: [...log.details, `Digit ${round + 1}: ${digits[round]}, expected ${match ? 'Same' : 'Different'}, answer ${same ? 'Same' : 'Different'}, ${ok ? 'correct' : 'incorrect'}`],
    };
    setLog(next);
    if (round === 11) onFinish({ test: 'two_back', correct: next.correct, details: next.details });
    else setRound(round + 1);
  };

  return (
    <>
      <p className="muted small">Digit {round + 1} of 12</p>
      <p className="cog-display big">{stage === 'showing' ? digits[round] : '?'}</p>
      {stage === 'answering' && (
        <>
          <p className="cog-display">Was this digit the same as TWO digits ago?</p>
          <div className="row">
            <button className="primary" onClick={() => answer(true)}>Same as two back</button>
            <button onClick={() => answer(false)}>Different</button>
          </div>
        </>
      )}
    </>
  );
}

// --- matrix reasoning & spatial orientation --------------------------------------------
function ChoiceTest({ code, questions, render, onFinish }) {
  const [i, setI] = useState(0);
  const [choice, setChoice] = useState(null);
  const [log, setLog] = useState({ correct: 0, details: [] });
  const q = questions[i];

  const submit = () => {
    if (choice == null) return;
    const ok = choice === q.correct;
    const next = {
      correct: log.correct + (ok ? 1 : 0),
      details: [...log.details, `Question ${i + 1}: expected ${q.correct}; answer ${choice}; ${ok ? 'correct' : 'incorrect'}`],
    };
    setLog(next);
    setChoice(null);
    if (i === questions.length - 1) onFinish({ test: code, correct: next.correct, details: next.details });
    else setI(i + 1);
  };

  return (
    <>
      <p className="muted small">Question {i + 1} of {questions.length}</p>
      {render(q)}
      <div className="choices" role="radiogroup">
        {q.options.map((o) => (
          <button key={o} role="radio" aria-checked={choice === o}
            className={choice === o ? 'choice selected' : 'choice'} onClick={() => setChoice(o)}>{o}</button>
        ))}
      </div>
      <button className="primary" onClick={submit} disabled={choice == null}>Submit</button>
    </>
  );
}

function Matrix({ onFinish }) {
  // Options are shuffled each time (in the original all correct answers were the 3rd option).
  const [questions] = useState(() => MATRIX_QUESTIONS.map((q) => ({ ...q, options: shuffle(q.options) })));
  return (
    <ChoiceTest code="matrix" questions={questions} onFinish={onFinish} render={(q) => (
      <>
        <p className="cog-display">Complete the matrix:</p>
        <table className="matrix"><tbody>
          {q.prompt.map((row, r) => <tr key={r}>{row.map((c, k) => <td key={k}>{c}</td>)}</tr>)}
        </tbody></table>
      </>
    )} />
  );
}

function Spatial({ onFinish }) {
  return (
    <ChoiceTest code="spatial" questions={SPATIAL_QUESTIONS} onFinish={onFinish}
      render={(q) => <p className="cog-display">{q.prompt}</p>} />
  );
}

// --- digit-symbol matching ------------------------------------------------------------
function Symbols({ onFinish }) {
  const [round, setRound] = useState(0);
  const [digit, setDigit] = useState(() => randInt(1, 5));
  const [now, setNow] = useState(0);
  const log = useRef({ correct: 0, details: [] });
  const start = useRef(performance.now());
  const done = useRef(false);

  const end = () => {
    if (done.current) return;
    done.current = true;
    onFinish({
      test: 'symbols',
      correct: log.current.correct,
      durationSec: Math.round((performance.now() - start.current) / 100) / 10,
      details: log.current.details,
    });
  };

  const answer = (d) => {
    if (done.current) return;
    if (performance.now() - start.current >= 60000) return end();
    const ok = d === digit;
    if (ok) log.current.correct++;
    log.current.details.push(`Symbol ${round + 1}: expected ${digit}; answer ${d}; ${ok ? 'correct' : 'incorrect'}`);
    if (round === 9) return end();
    setRound(round + 1);
    setDigit(randInt(1, 5));
    return undefined;
  };

  // Keyboard answers 1–5
  useEffect(() => {
    const onKey = (e) => {
      const d = Number(e.key);
      if (d >= 1 && d <= 5) answer(d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 60-second limit
  useEffect(() => {
    const t = setInterval(() => {
      const e = performance.now() - start.current;
      setNow(e);
      if (e >= 60000) end();
    }, 200);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <p className="muted small">Match {round + 1} of 10 · Time left: {Math.max(0, Math.ceil((60000 - now) / 1000))} s</p>
      <div className="key">
        {SYMBOLS.map((s, i) => <span key={s}><kbd>{i + 1}</kbd> = {s}</span>)}
      </div>
      <p className="cog-display">Which digit matches this symbol?</p>
      <p className="cog-display big">{SYMBOLS[digit - 1]}</p>
      <div className="row center">
        {[1, 2, 3, 4, 5].map((d) => <button key={d} className="digit" onClick={() => answer(d)}>{d}</button>)}
      </div>
    </>
  );
}
