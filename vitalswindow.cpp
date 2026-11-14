#include "vitalswindow.h"
#include "vitalchart.h"

#include <QDateTime>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QTimer>
#include <QVBoxLayout>

#include <algorithm>
#include <cmath>

namespace {
constexpr int kSampleIntervalSec = 2;
constexpr int kMaxSamples = 61;   // 2 minutes of history (60 intervals)

const QColor kPink("#f472b6");
const QColor kViolet("#a78bfa");
const QColor kTeal("#2dd4bf");
const QColor kOrange("#fb923c");
const QColor kBlue("#38bdf8");
} // namespace

VitalsWindow::VitalsWindow(const QString &crewMember, QWidget *parent)
    : QWidget(parent)
    , m_timer(new QTimer(this))
{
    setWindowTitle(tr("Cardio analysis – %1").arg(crewMember));
    setAttribute(Qt::WA_StyledBackground);
    setObjectName("vitalsWindow");
    setStyleSheet(R"(
        QWidget#vitalsWindow { background-color: #0b1120; }
        QLabel { background: transparent; color: #cbd5e1; }
        QLabel#title { color: #f8fafc; font-size: 26px; font-weight: 700; }
        QLabel#subtitle { color: #7dd3fc; font-size: 14px; }
        QLabel#updated { color: #64748b; font-size: 12px; }
        QLabel#summary {
            font-size: 13px; font-weight: 600;
            padding: 6px 14px; border-radius: 14px;
        }
    )");
    resize(1040, 720);
    setMinimumSize(720, 560);

    // Charts
    m_bp = new VitalChart(tr("Blood pressure"), "mmHg", 0, 50, 150, this);
    m_bp->addSeries(tr("Systolic"), kPink, 90, 130, 20);
    m_bp->addSeries(tr("Diastolic"), kViolet, 60, 85, 15);

    m_resp = new VitalChart(tr("Respiratory rate"), tr("breaths/min"), 0, 10, 26, this);
    m_resp->addSeries(tr("Respiration"), kTeal, 12, 20, 5);

    m_skin = new VitalChart(tr("Skin temperature"), "°C", 1, 32, 36, this);
    m_skin->addSeries(tr("Skin temp"), kOrange, 32.5, 35.5, 1.0);

    m_spo2 = new VitalChart(tr("Blood oxygen (SpO₂)"), "%", 0, 88, 100, this);
    m_spo2->addSeries(tr("SpO₂"), kBlue, 95, 100, 3);

    for (auto *c : {m_bp, m_resp, m_skin, m_spo2})
        c->setSampleInterval(kSampleIntervalSec);

    // Header
    auto *title = new QLabel(tr("Cardio analysis"), this);
    title->setObjectName("title");
    auto *subtitle = new QLabel(tr("%1  ·  simulated sensor feed  ·  last %2 min")
                                    .arg(crewMember)
                                    .arg((kMaxSamples - 1) * kSampleIntervalSec / 60),
                                this);
    subtitle->setObjectName("subtitle");

    m_summary = new QLabel(this);
    m_summary->setObjectName("summary");
    m_updated = new QLabel(this);
    m_updated->setObjectName("updated");
    m_updated->setAlignment(Qt::AlignRight);

    auto *titleCol = new QVBoxLayout;
    titleCol->setSpacing(2);
    titleCol->addWidget(title);
    titleCol->addWidget(subtitle);

    auto *statusCol = new QVBoxLayout;
    statusCol->setSpacing(6);
    statusCol->addWidget(m_summary, 0, Qt::AlignRight);
    statusCol->addWidget(m_updated, 0, Qt::AlignRight);

    auto *header = new QHBoxLayout;
    header->addLayout(titleCol, 1);
    header->addLayout(statusCol);

    auto *grid = new QGridLayout;
    grid->setSpacing(16);
    grid->addWidget(m_bp, 0, 0);
    grid->addWidget(m_spo2, 0, 1);
    grid->addWidget(m_resp, 1, 0);
    grid->addWidget(m_skin, 1, 1);

    auto *root = new QVBoxLayout(this);
    root->setContentsMargins(28, 24, 28, 28);
    root->setSpacing(20);
    root->addLayout(header);
    root->addLayout(grid, 1);

    // Simulated feed: prefill history, then keep streaming.
    m_sim = {118, 77, 15, 33.9, 97.6};
    for (int i = 0; i < kMaxSamples; ++i)
        simulateTick();

    connect(m_timer, &QTimer::timeout, this, &VitalsWindow::simulateTick);
    setSimulationEnabled(true);
}

void VitalsWindow::setSimulationEnabled(bool enabled)
{
    if (enabled)
        m_timer->start(kSampleIntervalSec * 1000);
    else
        m_timer->stop();
}

void VitalsWindow::addReading(const VitalsReading &r)
{
    m_bp->appendValue(0, r.systolic, kMaxSamples);
    m_bp->appendValue(1, r.diastolic, kMaxSamples);
    m_resp->appendValue(0, r.respiration, kMaxSamples);
    m_skin->appendValue(0, r.skinTemp, kMaxSamples);
    m_spo2->appendValue(0, r.spo2, kMaxSamples);

    m_updated->setText(tr("Updated %1").arg(QTime::currentTime().toString("HH:mm:ss")));
    updateSummary();
}

void VitalsWindow::updateSummary()
{
    int warn = 0, crit = 0;
    for (auto *c : {m_bp, m_resp, m_skin, m_spo2}) {
        if (c->status() == VitalChart::Status::Critical)
            ++crit;
        else if (c->status() == VitalChart::Status::Warning)
            ++warn;
    }

    QStringList parts;
    if (crit)
        parts << (crit == 1 ? tr("1 vital critical") : tr("%1 vitals critical").arg(crit));
    if (warn)
        parts << (warn == 1 ? tr("1 to check") : tr("%1 to check").arg(warn));

    QString text = parts.join(QStringLiteral("  ·  ")), fg, bg;
    if (crit) {
        fg = "#f87171"; bg = "rgba(248,113,113,0.15)";
    } else if (warn) {
        fg = "#fbbf24"; bg = "rgba(251,191,36,0.15)";
    } else {
        text = tr("All vitals normal");
        fg = "#34d399"; bg = "rgba(52,211,153,0.15)";
    }
    m_summary->setText("●  " + text);
    m_summary->setStyleSheet(QString("color:%1; background-color:%2;").arg(fg, bg));
}

void VitalsWindow::simulateTick()
{
    std::normal_distribution<double> noise(0.0, 1.0);
    const auto drift = [&](double &v, double target, double pull, double sd) {
        v += (target - v) * pull + noise(m_rng) * sd;
    };

    // Slow breathing / circadian-like oscillation, plus a periodic
    // desaturation episode so the alerting is visible in the demo.
    const double wave = std::sin(m_tick / 9.0);
    const int phase = m_tick % 90;
    const bool desaturation = phase >= 28 && phase < 40;

    drift(m_sim.systolic, 118 + 4 * wave, 0.15, 1.6);
    drift(m_sim.diastolic, 77 + 2.5 * wave, 0.15, 1.1);
    drift(m_sim.respiration, desaturation ? 21.5 : 15 + wave, 0.2, 0.45);
    drift(m_sim.skinTemp, 33.9 + 0.25 * wave, 0.1, 0.05);
    drift(m_sim.spo2, desaturation ? 93.0 : 97.6, 0.25, 0.3);
    m_sim.spo2 = std::min(m_sim.spo2, 100.0);

    ++m_tick;
    addReading(m_sim);
}
