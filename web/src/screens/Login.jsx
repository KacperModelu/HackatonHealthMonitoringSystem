import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

// Login screen (login.ui): choose an astronaut, log in, add or delete a user.
export default function Login({ selected }) {
  const [crew, setCrew] = useState(null);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');

  const load = async (select) => {
    try {
      const list = await api.crew();
      setCrew(list);
      const keep = list.find((c) => c.id === select);
      setCurrent(String(keep ? keep.id : list[0]?.id ?? ''));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(selected); }, [selected]);

  const person = crew?.find((c) => String(c.id) === current);

  const remove = async () => {
    if (!person) return;
    if (!window.confirm(`Delete ${person.name} and all generated health data? This cannot be undone.`)) return;
    try {
      await api.deleteCrew(person.id);
      await load(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const reference = crew?.filter((c) => !c.createdInApp) ?? [];
  const added = crew?.filter((c) => c.createdInApp) ?? [];
  const option = (c) => (
    <option key={c.id} value={c.id}>
      {c.name}{c.mission ? ` · ${c.mission}` : ''}
    </option>
  );

  return (
    <main className="center-screen">
      <section className="card login-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <h1>Health Monitor</h1>
        </div>

        <label className="field">
          <span>Choose an astronaut:</span>
          <select value={current} onChange={(e) => setCurrent(e.target.value)} disabled={!crew?.length}>
            {crew && !crew.length && <option value="">No astronauts yet</option>}
            {added.length > 0 && <optgroup label="Added in the app">{added.map(option)}</optgroup>}
            {reference.length > 0 && <optgroup label="Reference crew">{reference.map(option)}</optgroup>}
          </select>
        </label>
        {person && (
          <p className="muted small">
            {person.age} years · {person.sex === 'F' ? 'Woman' : 'Man'}
            {person.mission ? ` · last mission ${person.mission}` : ' · annual tests only'}
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="stack">
          <button className="primary" disabled={!person} onClick={() => go(`/crew/${person.id}`)}>
            Log in
          </button>
          <button onClick={() => go('/new')}>Add user</button>
          <button
            className="danger"
            disabled={!person?.createdInApp}
            title={person && !person.createdInApp ? 'Only users added in the app can be deleted' : undefined}
            onClick={remove}
          >
            Delete user
          </button>
        </div>
      </section>
    </main>
  );
}
