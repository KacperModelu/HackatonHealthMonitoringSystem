#ifndef CARDIODB_H
#define CARDIODB_H

#include <QString>

// Access to the cardiology database (database/cardio_analysis.db, SQLite).
// Uses Qt's default QSqlDatabase connection.
namespace CardioDb {

// Where the database file is looked up: next to the executable first,
// then in the source tree (database/cardio_analysis.db).
QString defaultPath();

// Opens the database. Never creates a new empty file.
bool open(const QString &path, QString *error = nullptr);
bool isOpen();

// Opens the default database if it isn't open yet.
bool ensureOpen(QString *error = nullptr);

} // namespace CardioDb

#endif // CARDIODB_H
