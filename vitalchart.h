#ifndef VITALCHART_H
#define VITALCHART_H

#include <QColor>
#include <QString>
#include <QVector>
#include <QWidget>

// A card showing one vital sign: current value, status and a trend line
// with the normal range shaded. Supports several series (e.g. systolic and
// diastolic blood pressure) drawn on the same axes.
class VitalChart : public QWidget
{
    Q_OBJECT

public:
    enum class Status { Normal, Warning, Critical };

    struct Series
    {
        QString name;
        QColor color;
        double normalLow = 0;
        double normalHigh = 0;
        // Values further than this outside the normal range are Critical.
        double criticalMargin = 0;
        QVector<double> values;
    };

    explicit VitalChart(const QString &title, const QString &unit, int decimals,
                        double axisMin, double axisMax, QWidget *parent = nullptr);

    int addSeries(const QString &name, const QColor &color,
                  double normalLow, double normalHigh, double criticalMargin);
    void setValues(int series, const QVector<double> &values);
    void appendValue(int series, double value, int maxSamples);

    // Seconds between samples, used for the time axis labels.
    void setSampleInterval(int seconds);

    Status status() const;
    QString title() const { return m_title; }

    QSize sizeHint() const override { return {420, 260}; }
    QSize minimumSizeHint() const override { return {300, 220}; }

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    Status seriesStatus(const Series &s) const;
    QString formatValue(double v) const;

    QString m_title;
    QString m_unit;
    int m_decimals;
    double m_axisMin;
    double m_axisMax;
    int m_sampleInterval = 2;
    QVector<Series> m_series;
};

#endif // VITALCHART_H
