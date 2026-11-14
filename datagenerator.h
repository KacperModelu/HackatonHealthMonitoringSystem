#ifndef DATAGENERATOR_H
#define DATAGENERATOR_H

#include <QString>
#include <QStringList>

#include <optional>

// Generates a FAKE but physiologically plausible health record for a new
// crew member and stores it in the cardio database:
//   * a completed mission (~5–6 months, returned ~5–6 weeks ago),
//   * cycle ergometer tests following the NASA N3.07 schedule
//     (annual, L-12 m, L-90/30 supine + upright, FD 14, FD 75, R-14, R+5, R+30)
//     with per-stage HR/VO2/RPE and blood pressure,
//   * resting ECG before and after flight (MEDB 1.6),
//   * vitals twice a day during the whole flight.
// For variety, each person randomly gets 0–3 deviations from the norm
// (fever, hypertension, desaturation, sensor artifacts, ...). What was
// simulated is recorded in the simulated_event table as ground truth.
namespace DataGenerator {

struct Person
{
    QString firstName;
    QString lastName;
    int age = 0;
    char sex = 'M';                       // 'M' or 'F'
    std::optional<double> heightCm;       // random plausible value if missing
    std::optional<double> weightKg;
};

struct Result
{
    int crewId = -1;
    QString mission;
    int vitalsReadings = 0;
    int cycleTests = 0;
    int ecgs = 0;
    QStringList events;                   // human-readable list of simulated deviations
};

// Runs in a single transaction: either everything is stored or nothing.
std::optional<Result> generate(const Person &person, QString *error = nullptr);

} // namespace DataGenerator

#endif // DATAGENERATOR_H
