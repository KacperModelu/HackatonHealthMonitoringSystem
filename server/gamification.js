// Points, streaks, ranks and badges computed from task_completion
// Everything is derived on the fly, so the rules live only here.

export const DAILY_GOAL = 50;   // points per day

// Thresholds for points earned in the last 30 days (max ~80 per day).
const RANKS = [
  ['Cadet', 0], ['Specialist', 300], ['Pilot', 700],
  ['Flight Engineer', 1100], ['Commander', 1500], ['Space Ace', 1900],
];

const DAY = 86400000;   // milliseconds in a day
// Moves a 'YYYY-MM-DD' date by n days. The date is parsed as UTC midnight, so the
// arithmetic is pure calendar math and daylight-saving changes cannot shift a day.
const shift = (isoDate, n) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// "Today" in the server's local time zone (not UTC): a task ticked at 00:30 local time
// should count for the new day. Assessments, by contrast, store full UTC timestamps.
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Everything the "Daily tasks" tab shows, computed from scratch on every request.
// Nothing is cached or stored: un-ticking a task simply deletes its row and all the
// numbers below follow. `today` is a parameter so tests can pin the date.
export function computeSummary(db, crewId, today = localToday()) {
  // One row per day with at least one completed task: points and task count that day.
  const days = db.prepare(
    `SELECT tc.completed_on AS day, SUM(t.points) AS points, COUNT(*) AS tasks
     FROM task_completion tc JOIN health_task t ON t.id = tc.task_id
     WHERE tc.crew_id = ? GROUP BY tc.completed_on ORDER BY tc.completed_on`,
  ).all(crewId);
  // How many times each task was ever done, keyed by task code (used by the badges).
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

  // Best streak ever: walk the active days in order and count runs of consecutive dates.
  let bestStreak = 0;
  let run = 0;
  let prev = null;
  for (const { day } of days) {
    if (day > today) break;
    run = prev && shift(prev, 1) === day ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = day;
  }

  // Rank is based on a rolling 30-day window, not on lifetime points: it reflects the
  // current habit and drops again if the person stops. All 8 tasks give 80 points a
  // day (2400 per 30 days), so the top rank needs about 79% of the maximum.
  let monthPoints = 0;
  for (let i = 0; i < 30; i++) monthPoints += byDay.get(shift(today, -i)) ?? 0;
  let idx = 0;   // highest rank whose threshold has been reached
  RANKS.forEach(([, min], i) => { if (monthPoints >= min) idx = i; });
  const rank = {
    name: RANKS[idx][0],
    monthPoints,
    minPoints: RANKS[idx][1],
    nextName: RANKS[idx + 1]?.[0] ?? null,
    nextPoints: RANKS[idx + 1]?.[1] ?? null,
  };

  // A badge is earned when `have` reaches `need`; progress is shown as "have / need".
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
