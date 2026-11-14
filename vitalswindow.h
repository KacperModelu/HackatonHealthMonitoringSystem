#ifndef VITALSWINDOW_H
#define VITALSWINDOW_H

#include <QWidget>

#include <random>

class QLabel;
class QTimer;
class VitalChart;

// One reading from the crew member's sensors.
struct VitalsReading
{
    double systolic;      // mmHg
    double diastolic;     // mmHg
    double respiration;   // breaths / min
    double skinTemp;      // °C
    double spo2;          // %
};

// Window with a graphical analysis of cardio-respiratory vitals:
// blood pressure, respiratory rate, skin temperature and blood oxygen.
class VitalsWindow : public QWidget
{
    Q_OBJECT

public:
    explicit VitalsWindow(const QString &crewMember, QWidget *parent = nullptr);

    // Feed a new reading (from real sensors, or the built-in simulator).
    void addReading(const VitalsReading &r);

    // Turn the built-in simulated sensor feed on or off.
    void setSimulationEnabled(bool enabled);

private:
    void updateSummary();
    void simulateTick();

    VitalChart *m_bp;
    VitalChart *m_resp;
    VitalChart *m_skin;
    VitalChart *m_spo2;
    QLabel *m_summary;
    QLabel *m_updated;
    QTimer *m_timer;

    // Simulator state
    VitalsReading m_sim;
    int m_tick = 0;
    std::mt19937 m_rng{42};
};

#endif // VITALSWINDOW_H
