#ifndef GAMIFICATION_H
#define GAMIFICATION_H

#include <QDate>
#include <QList>
#include <QString>

// Points, streaks, ranks and badges computed from the task history in the
// database. Everything is derived on the fly, so the rules live here only.
namespace Gamification {

constexpr int kDailyGoal = 50;   // points per day

struct Rank
{
    QString name;
    int monthPoints;        // points in the last 30 days
    int minPoints;          // threshold of this rank
    int nextPoints;         // threshold of the next rank (-1 at the top)
    QString nextName;
};

struct Badge
{
    QString icon;
    QString title;
    QString description;
    bool earned;
    QString progress;       // e.g. "12 / 30"
};

struct Summary
{
    int todayPoints = 0;
    int totalPoints = 0;
    int currentStreak = 0;  // days in a row with at least one task, up to today
    int bestStreak = 0;
    QList<int> lastSevenDays;   // points per day, oldest first (6 days ago .. today)
    Rank rank;
    QList<Badge> badges;
};

Summary compute(int crewId, const QDate &today);

} // namespace Gamification

#endif // GAMIFICATION_H
