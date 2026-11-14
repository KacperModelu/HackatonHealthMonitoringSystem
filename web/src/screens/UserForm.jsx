import { useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

const EMPTY = { firstName: '', lastName: '', age: '', sex: 'M', heightCm: '', weightKg: '' };

// New user form (mainform.ui). "Generate user data" creates the person and a
// full fake health record with 0–3 random deviations from the norm.
export default function UserForm() {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setResult(await api.createCrew(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <main className="center-screen">
        <section className="card form-card" role="dialog" aria-labelledby="done-title">
          <h1 id="done-title">Data generated</h1>
          <p>
            Generated data for <strong>{form.firstName} {form.lastName}</strong> (crew id {result.crewId},
            mission {result.mission}):
          </p>
          <ul className="facts">
            <li><strong>{result.vitalsReadings}</strong> vitals readings (twice a day in flight)</li>
            <li><strong>{result.cycleTests}</strong> cycle ergometer tests</li>
            <li><strong>{result.ecgs}</strong> resting ECGs</li>
          </ul>
          {result.events.length === 0 ? (
            <p className="pill ok">No deviations from the norm were simulated (healthy profile).</p>
          ) : (
            <>
              <h2>Simulated deviations from the norm</h2>
              <ul className="events">
                {result.events.map((ev) => (
                  <li key={ev.kind}>
                    {ev.text}
                    {ev.start && <span className="muted"> · flight days {ev.start}–{ev.end}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            <button className="primary" onClick={() => go(`/?selected=${result.crewId}`)}>OK</button>
            <button onClick={() => go(`/crew/${result.crewId}`)}>Open dashboard</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="center-screen">
      <form className="card form-card" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <h1>Health Monitor System</h1>
        </div>

        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input value={form.firstName} onChange={set('firstName')} autoFocus autoComplete="off" />
          </label>
          <label className="field">
            <span>Surname</span>
            <input value={form.lastName} onChange={set('lastName')} autoComplete="off" />
          </label>
          <label className="field">
            <span>Age</span>
            <input value={form.age} onChange={set('age')} inputMode="numeric" placeholder="18–99" />
          </label>
          <label className="field">
            <span>Biological sex</span>
            <select value={form.sex} onChange={set('sex')}>
              <option value="M">Man</option>
              <option value="F">Woman</option>
            </select>
          </label>
          <label className="field">
            <span>Height <em className="muted">(cm, optional)</em></span>
            <input value={form.heightCm} onChange={set('heightCm')} inputMode="decimal" placeholder="random" />
          </label>
          <label className="field">
            <span>Weight <em className="muted">(kg, optional)</em></span>
            <input value={form.weightKg} onChange={set('weightKg')} inputMode="decimal" placeholder="random" />
          </label>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate user data'}
          </button>
          <button type="button" onClick={() => go('/')}>Cancel</button>
        </div>
      </form>
    </main>
  );
}
