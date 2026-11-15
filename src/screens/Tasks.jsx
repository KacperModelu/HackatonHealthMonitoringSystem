import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORY = { measure: 'Measure', exercise: 'Exercise', recovery: 'Recovery', learn: 'Learn' };

// Gamification: daily health tasks, points, streaks, rank and badges.
export default function Tasks({ crewId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.tasks(crewId).then(setData).catch((e) => setError(e.message));
  }, [crewId]);

  // The server answers with the complete, recalculated summary, so the points, streak,
  // rank and badges on screen always match the database.
  const toggle = async (task, done) => {
    try {
      setData(await api.setTask(crewId, task.id, done));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const { summary: s, tasks, doneToday } = data;
  // Widths of the progress bars: today's points against the daily goal, and how far
  // the 30-day points are between the current rank's threshold and the next one.
  // maxWeek scales the 7-day mini chart (at least as tall as the daily goal).
  const goalPct = Math.min(100, Math.round((100 * s.todayPoints) / s.dailyGoal));
  const rankPct = s.rank.nextPoints
    ? Math.round((100 * (s.rank.monthPoints - s.rank.minPoints)) / (s.rank.nextPoints - s.rank.minPoints))
    : 100;
  const maxWeek = Math.max(s.dailyGoal, ...s.lastSevenDays.map((d) => d.points));

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <span className="stat-label">Today</span>
          <span className="stat-value">{s.todayPoints} <small>/ {s.dailyGoal} pts</small></span>
          <div className="bar"><div style={{ width: `${goalPct}%` }} /></div>
        </div>
        <div className="card stat">
          <span className="stat-label">Streak</span>
          <span className="stat-value">🔥 {s.currentStreak} <small>days (best {s.bestStreak})</small></span>
        </div>
        <div className="card stat">
          <span className="stat-label">Rank</span>
          <span className="stat-value">{s.rank.name}</span>
          <div className="bar"><div style={{ width: `${rankPct}%` }} /></div>
          <span className="muted small">
            {s.rank.monthPoints} pts in 30 days
            {s.rank.nextName ? ` · ${s.rank.nextPoints - s.rank.monthPoints} to ${s.rank.nextName}` : ' · top rank'}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Last 7 days</span>
          <div className="week" aria-label="Points per day, last 7 days">
            {s.lastSevenDays.map((d) => (
              <div key={d.day} className="week-col" title={`${d.day}: ${d.points} pts`}>
                <div className={d.points >= s.dailyGoal ? 'goal' : ''} style={{ height: `${(100 * d.points) / maxWeek}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2 gap-lg">
        <section className="card">
          <h2>Today's tasks <span className="muted small">{s.today}</span></h2>
          <ul className="tasks">
            {tasks.map((t) => {
              const done = doneToday.includes(t.id);
              return (
                <li key={t.id} className={done ? 'done' : ''}>
                  <label>
                    <input type="checkbox" checked={done} onChange={(e) => toggle(t, e.target.checked)} />
                    <span>
                      <strong>{t.title}</strong> <span className="pill neutral">+{t.points}</span>
                      <span className="tag">{CATEGORY[t.category]}</span>
                      <span className="muted small block">{t.description}</span>
                      <span className="small block why">Why: {t.why}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="card">
          <h2>Badges</h2>
          <ul className="badges">
            {s.badges.map((b) => (
              <li key={b.title} className={b.earned ? 'earned' : ''}>
                <span className="badge-icon" aria-hidden="true">{b.icon}</span>
                <span>
                  <strong>{b.title}</strong>
                  <span className="muted small block">{b.description}</span>
                </span>
                <span className="small">{b.earned ? '✓' : b.progress}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
