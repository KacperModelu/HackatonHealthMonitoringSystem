import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

// Login screen: choose an astronaut, log in, add or delete a user.
// There are no passwords: "Log in" just opens the chosen person's dashboard.
// The list contains only profiles created in the app; the preloaded reference crew
// is filtered out by the server (GET /api/crew).
export default function Login({ selected }) {
  const [crew, setCrew] = useState(null);       // null = still loading
  const [current, setCurrent] = useState('');   // id of the chosen person, as a string (<select> value)
  const [error, setError] = useState('');

  // Loads the list and chooses who is selected: the requested id if it still
  // exists (e.g. the person just created), otherwise the first one.
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
            {crew?.map(option)}
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
          <button className="danger" disabled={!person} onClick={remove}>
            Delete user
          </button>
        </div>

        <button className="link-button" onClick={() => go('/satellites')}>
          Satellite visualisation
        </button>
      </section>
    </main>
  );
}
