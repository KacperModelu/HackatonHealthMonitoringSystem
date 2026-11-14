#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include "cardiodb.h"
#include "healthstatus.h"

#include <QHash>
#include <QMainWindow>

class QButtonGroup;
class QCheckBox;
class QComboBox;
class QGridLayout;
class QLabel;
class QListWidget;
class QProgressBar;
class QTextBrowser;
class TrendChart;

QT_BEGIN_NAMESPACE
namespace Ui {
class MainWindow;
}
QT_END_NAMESPACE

// Health dashboard for one crew member: colour-coded overview, trend charts,
// gamified health tasks and a plain-language guide.
class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(int crewId, QWidget *parent = nullptr);
    ~MainWindow() override;

private:
    void buildOverview();
    void buildTrends();
    void buildTasks();
    void buildGuide();

    void updateVitalsChart();
    void updateVo2Chart();
    void refreshGamification();
    void showTrend(int indicator);
    void showGuide(const QString &topic);
    void onTaskToggled(int taskId, bool done);

    Ui::MainWindow *ui;
    int m_crewId;
    CardioDb::CrewProfile m_profile;
    QList<CardioDb::VitalsPoint> m_vitals;
    QList<CardioDb::Vo2Point> m_vo2;
    std::optional<double> m_vo2Baseline;

    // Trends
    QComboBox *m_indicatorCombo = nullptr;
    QButtonGroup *m_rangeGroup = nullptr;
    TrendChart *m_vitalsChart = nullptr;
    TrendChart *m_vo2Chart = nullptr;
    QLabel *m_trendExplain = nullptr;
    QLabel *m_trendStats = nullptr;

    // Tasks
    QHash<int, QCheckBox *> m_taskChecks;
    QHash<int, int> m_taskPoints;
    QLabel *m_todayLabel = nullptr;
    QProgressBar *m_todayBar = nullptr;
    QLabel *m_streakLabel = nullptr;
    QLabel *m_rankLabel = nullptr;
    QProgressBar *m_rankBar = nullptr;
    QLabel *m_weekLabel = nullptr;
    QGridLayout *m_badgeGrid = nullptr;

    // Guide
    QListWidget *m_topicList = nullptr;
    QTextBrowser *m_guideText = nullptr;
};

#endif // MAINWINDOW_H
