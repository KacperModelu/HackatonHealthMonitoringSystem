#include "gamification.h"
#include "cardiodb.h"

#include <QHash>
#include <QObject>

#include <algorithm>

namespace Gamification {

namespace {

struct RankDef
{
    const char *name;
    int minPoints;
};

// Thresholds for points earned in the last 30 days (max ~80 per day).
const RankDef kRanks[] = {
    {"Cadet", 0},
    {"Specialist", 300},
    {"Pilot", 700},
    {"Flight Engineer", 1100},
    {"Commander", 1500},
    {"Space Ace", 1900},
};

Rank rankFor(int monthPoints)
{
    const int count = int(std::size(kRanks));
    int idx = 0;
    for (int i = 0; i < count; ++i)
        if (monthPoints >= kRanks[i].minPoints)
            idx = i;
    Rank r;
    r.name = QObject::tr(kRanks[idx].name);
    r.monthPoints = monthPoints;
    r.minPoints = kRanks[idx].minPoints;
    if (idx + 1 < count) {
        r.nextPoints = kRanks[idx + 1].minPoints;
        r.nextName = QObject::tr(kRanks[idx + 1].name);
    } else {
        r.nextPoints = -1;
    }
    return r;
}

Badge countBadge(const QString &icon, const QString &title, const QString &description,
                 int have, int need)
{
    return {icon, title, description, have >= need,
            QStringLiteral("%1 / %2").arg(std::min(have, need)).arg(need)};
}

} // namespace

Summary compute(int crewId, const QDate &today)
{
    Summary s;
    const auto days = CardioDb::pointsPerDay(crewId);
    const auto perTask = CardioDb::completionsPerTask(crewId);

    QHash<QDate, int> pointsByDay;
    int maxTasksInDay = 0;
    for (const auto &d : days) {
        pointsByDay.insert(d.day, d.points);
        s.totalPoints += d.points;
        maxTasksInDay = std::max(maxTasksInDay, d.tasks);
    }
    s.todayPoints = pointsByDay.value(today);

    for (int i = 6; i >= 0; --i)
        s.lastSevenDays.append(pointsByDay.value(today.addDays(-i)));

    // Current streak: today counts if done; otherwise the streak is still
    // alive if yesterday was done.
    QDate d = pointsByDay.contains(today) ? today : today.addDays(-1);
    while (pointsByDay.contains(d)) {
        ++s.currentStreak;
        d = d.addDays(-1);
    }

    int run = 0;
    QDate prev;
    for (const auto &day : days) {
        if (day.day > today)
            break;
        run = (prev.isValid() && prev.addDays(1) == day.day) ? run + 1 : 1;
        s.bestStreak = std::max(s.bestStreak, run);
        prev = day.day;
    }

    int monthPoints = 0;
    for (int i = 0; i < 30; ++i)
        monthPoints += pointsByDay.value(today.addDays(-i));
    s.rank = rankFor(monthPoints);

    const int totalTasks = int(CardioDb::healthTasks().size());
    s.badges = {
        countBadge(QStringLiteral("🚀"), QObject::tr("First step"),
                   QObject::tr("Complete your first health task."),
                   int(days.isEmpty() ? 0 : 1), 1),
        countBadge(QStringLiteral("🔥"), QObject::tr("Week streak"),
                   QObject::tr("Complete at least one task 7 days in a row."),
                   s.bestStreak, 7),
        countBadge(QStringLiteral("🌕"), QObject::tr("Month streak"),
                   QObject::tr("Keep a streak for 30 days."), s.bestStreak, 30),
        countBadge(QStringLiteral("❤️"), QObject::tr("Heart watcher"),
                   QObject::tr("Do 30 morning vitals checks."),
                   perTask.value(QStringLiteral("morning_vitals")), 30),
        countBadge(QStringLiteral("🚴"), QObject::tr("Endurance"),
                   QObject::tr("Complete 50 aerobic sessions."),
                   perTask.value(QStringLiteral("aerobic")), 50),
        countBadge(QStringLiteral("📚"), QObject::tr("Curious mind"),
                   QObject::tr("Read 8 guide topics."),
                   perTask.value(QStringLiteral("learn")), 8),
        countBadge(QStringLiteral("⭐"), QObject::tr("Perfect day"),
                   QObject::tr("Complete every task in a single day."),
                   maxTasksInDay, totalTasks),
    };
    return s;
}

} // namespace Gamification
