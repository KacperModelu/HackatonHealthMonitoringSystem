#ifndef CARDIODB_H
#define CARDIODB_H

#include <QDate>
#include <QDateTime>
#include <QHash>
#include <QList>
#include <QString>
#include <QStringList>

#include <optional>

// Access to the cardiology database (database/cardio_analysis.db, SQLite).
// Uses Qt's default QSqlDatabase connection, opened once in main().
namespace CardioDb {

// Where the database file is looked up: next to the executable first,
// then in the source tree (database/cardio_analysis.db).
QString defaultPath();

// Opens the database. Never creates a new empty file.
bool open(const QString &path, QString *error = nullptr);
bool isOpen();

struct CrewEntry
{
    int id;
    QString fullName;
};

// All crew members, sorted by surname.
QList<CrewEntry> crewMembers();

struct NewCrewMember
{
    QString firstName;
    QString lastName;
    int age = 0;
    char sex = 'M';                    // 'M' or 'F'
    std::optional<double> heightCm;
    std::optional<double> weightKg;
};

// Inserts a crew member and returns its id, or -1 on error.
int addCrewMember(const NewCrewMember &member, QString *error = nullptr);

// --- Dashboard queries ------------------------------------------------------

struct CrewProfile
{
    int id = -1;
    QString fullName;
    QString sex;
    int age = 0;
    std::optional<double> heightCm;
    std::optional<double> weightKg;
    QString mission;          // empty when not assigned
    QString role;
    QDate launch;
    QDate returnDate;
};
CrewProfile profile(int crewId);

struct VitalsPoint
{
    QDateTime time;
    int flightDay;
    double systolic, diastolic, heartRate, respRate, skinTemp, spo2;
};
// In-flight readings, oldest first.
QList<VitalsPoint> vitalsHistory(int crewId);

struct Vo2Point
{
    QDate date;
    QString label;            // schedule label, e.g. 'FD 14'
    QString phase;            // annual / preflight / inflight / postflight
    std::optional<double> vo2peak;   // ml/kg/min, missing without gas analysis
    int peakWatts;
    int hrPeak;
};
// Completed upright/in-flight cycle tests, oldest first.
QList<Vo2Point> vo2History(int crewId);

struct ReferenceRange
{
    QString parameter;
    QString unit;
    std::optional<double> normalLow, normalHigh, criticalLow, criticalHigh;
};
QList<ReferenceRange> referenceRanges();

struct HealthTask
{
    int id;
    QString code, title, description, why, category;
    int points;
};
QList<HealthTask> healthTasks();
QList<int> completedTaskIds(int crewId, const QDate &day);
bool setTaskDone(int crewId, int taskId, const QDate &day, bool done, QString *error = nullptr);

struct DayPoints
{
    QDate day;
    int points;
    int tasks;
};
// Points earned per day (days without completions are omitted), oldest first.
QList<DayPoints> pointsPerDay(int crewId);
// Number of completions per task code.
QHash<QString, int> completionsPerTask(int crewId);

struct GuideTopic
{
    QString topic, title, whatItIs;
    QStringList howToMeasure;
    QString whyInSpace, whenToAct;
    int requirementId = 0;    // 0 when not tied to a medical requirement
};
QList<GuideTopic> guideTopics();
// Preparation rules and schedule for a medical requirement (from the MRID documents).
QStringList requirementConstraints(int requirementId);
QStringList requirementSchedule(int requirementId);

} // namespace CardioDb

#endif // CARDIODB_H
