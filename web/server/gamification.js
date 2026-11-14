// Points, streaks, ranks and badges computed from task_completion
// (same rules as the Qt dashboard on the cardio_analysis branch).

export const DAILY_GOAL = 50;   // points per day

// Thresholds for points earned in the last 30 days (max ~80 per day).
const RANKS = [
  ['Cadet', 0], ['Specialist', 300], ['Pilot', 700],
  ['Flight Engineer', 1100], ['Commander', 1500], ['Space Ace', 1900],
];

const DAY = 86400000;
const shift = (isoDate, n) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function computeSummary(db, crewId, today = localToday()) {
  const days = db.prepare(
    `SELECT tc.completed_on AS day, SUM(t.points) AS points, COUNT(*) AS tasks
     FROM task_completion tc JOIN health_task t ON t.id = tc.task_id
     WHERE tc.crew_id = ? GROUP BY tc.completed_on ORDER BY tc.completed_on`,
  ).all(crewId);
  const perTask = Object.fromEntries(db.prepare(
    `SELECT t.code, COUNT(*) AS n FROM task_completion tc JOIN health_task t ON t.id = tc.task_id
     WHERE tc.crew_id = ? GROUP BY t.code`,
  ).all(crewId).map((r) => [r.code, r.n]));
  const totalTasks = db.prepare('SELECT COUNT(*) AS n FROM health_task').get().n;

  const byDay = new Map(days.map((d) => [d.day, d.points]));
  const totalPoints = days.reduce((s, d) => s + d.points, 0);
  const maxTasksInDay = days.reduce((m, d) => Math.max(m, d.tasks), 0);

  const lastSevenDays = [];
  for (let i = 6; i >= 0; i--) {
    const day = shift(today, -i);
    lastSevenDays.push({ day, points: byDay.get(day) ?? 0 });
  }

  // Current streak: today counts if done; otherwise it is still alive if yesterday was done.
  let currentStreak = 0;
  let d = byDay.has(today) ? today : shift(today, -1);
  while (byDay.has(d)) {
    currentStreak++;
    d = shift(d, -1);
  }

  let bestStreak = 0;
  let run = 0;
  let prev = null;
  for (const { day } of days) {
    if (day > today) break;
    run = prev && shift(prev, 1) === day ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = day;
  }

  let monthPoints = 0;
  for (let i = 0; i < 30; i++) monthPoints += byDay.get(shift(today, -i)) ?? 0;
  let idx = 0;
  RANKS.forEach(([, min], i) => { if (monthPoints >= min) idx = i; });
  const rank = {
    name: RANKS[idx][0],
    monthPoints,
    minPoints: RANKS[idx][1],
    nextName: RANKS[idx + 1]?.[0] ?? null,
    nextPoints: RANKS[idx + 1]?.[1] ?? null,
  };

  const badge = (icon, title, description, have, need) =>
    ({ icon, title, description, earned: have >= need, progress: `${Math.min(have, need)} / ${need}` });

  return {
    today,
    dailyGoal: DAILY_GOAL,
    todayPoints: byDay.get(today) ?? 0,
    totalPoints,
    currentStreak,
    bestStreak,
    lastSevenDays,
    rank,
    badges: [
      badge('🚀', 'First step', 'Complete your first health task.', days.length ? 1 : 0, 1),
      badge('🔥', 'Week streak', 'Complete at least one task 7 days in a row.', bestStreak, 7),
      badge('🌕', 'Month streak', 'Keep a streak for 30 days.', bestStreak, 30),
      badge('❤️', 'Heart watcher', 'Do 30 morning vitals checks.', perTask.morning_vitals ?? 0, 30),
      badge('🚴', 'Endurance', 'Complete 50 aerobic sessions.', perTask.aerobic ?? 0, 50),
      badge('📚', 'Curious mind', 'Read 8 guide topics.', perTask.learn ?? 0, 8),
      badge('⭐', 'Perfect day', 'Complete every task in a single day.', maxTasksInDay, totalTasks),
    ],
  };
}
