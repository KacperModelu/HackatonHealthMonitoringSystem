#ifndef TRENDCHART_H
#define TRENDCHART_H

#include "healthstatus.h"

#include <QColor>
#include <QPointF>
#include <QString>
#include <QStringList>
#include <QVector>
#include <QWidget>

#include <functional>
#include <optional>

// Line chart of a health indicator over time. The normal range is shaded,
// every point is coloured by its status, and hovering shows the exact value.
class TrendChart : public QWidget
{
    Q_OBJECT

public:
    struct Series
    {
        QString name;
        QColor color;
        QVector<QPointF> points;                          // x: time (ms) or category index
        std::function<Health::Status(double)> classify;   // colours each point
        std::optional<double> bandLow, bandHigh;          // normal range to shade
    };

    explicit TrendChart(QWidget *parent = nullptr);

    void setSeries(const QVector<Series> &series);
    void setUnit(const QString &unit, int decimals);
    // Time axis (x = ms since epoch) or category axis (x = index, these labels).
    void setTimeAxis();
    void setCategories(const QStringList &labels);
    void setEmptyText(const QString &text);

    QSize sizeHint() const override { return {700, 320}; }
    QSize minimumSizeHint() const override { return {360, 220}; }

protected:
    void paintEvent(QPaintEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void leaveEvent(QEvent *event) override;

private:
    QRectF plotRect() const;
    QPointF toPixel(const QPointF &p) const;
    QString xLabel(double x, bool full) const;
    void updateBounds();

    QVector<Series> m_series;
    QString m_unit;
    int m_decimals = 0;
    QStringList m_categories;
    bool m_timeAxis = true;
    QString m_emptyText;
    double m_xMin = 0, m_xMax = 1, m_yMin = 0, m_yMax = 1;
    int m_hoverSeries = -1;
    int m_hoverIndex = -1;
};

#endif // TRENDCHART_H
