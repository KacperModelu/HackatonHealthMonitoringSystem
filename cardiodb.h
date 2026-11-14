#ifndef CARDIODB_H
#define CARDIODB_H

#include <QList>
#include <QString>

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

} // namespace CardioDb

#endif // CARDIODB_H
