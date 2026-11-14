import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Plain-language explanations of each indicator (indicator_guide table).
export default function Guide() {
  const [topics, setTopics] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.guide().then((t) => { setTopics(t); setOpen(t[0]?.topic); }).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!topics) return <p className="muted">Loading…</p>;

  return (
    <div className="guide">
      {topics.map((t) => (
        <section key={t.topic} className="card">
          <button className="guide-head" aria-expanded={open === t.topic}
            onClick={() => setOpen(open === t.topic ? null : t.topic)}>
            <h2>{t.title}</h2>
            <span aria-hidden="true">{open === t.topic ? '−' : '+'}</span>
          </button>
          {open === t.topic && (
            <div className="guide-body">
              <h3>What it is</h3>
              <p>{t.what_it_is}</p>
              <h3>How to measure</h3>
              <ol>{t.how_to_measure.map((s) => <li key={s}>{s}</li>)}</ol>
              <h3>Why it matters in space</h3>
              <p>{t.why_in_space}</p>
              <h3>When to act</h3>
              <p className="act">{t.when_to_act}</p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
