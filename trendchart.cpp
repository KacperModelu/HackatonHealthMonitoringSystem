#include "trendchart.h"

#include <QDateTime>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QTimeZone>

#include <algorithm>
#include <cmath>

namespace {
const QColor kGrid("#e2e8f0");
const QColor kAxisText("#64748b");
const QColor kText("#0f172a");

// "Nice" tick step for an axis span (1, 2, 2.5, 5 × 10^n).
double niceStep(double span, int targetTicks)
{
    const double raw = span / std::max(1, targetTicks);
    const double mag = std::pow(10.0, std::floor(std::log10(raw)));
    for (double m : {1.0, 2.0, 2.5, 5.0, 10.0})
        if (raw <= m * mag)
            return m * mag;
    return 10 * mag;
}
} // namespace

TrendChart::TrendChart(QWidget *parent)
    : QWidget(parent)
{
    setMouseTracking(true);
    setAttribute(Qt::WA_Hover);
}

void TrendChart::setSeries(const QVector<Series> &series)
{
    m_series = series;
    m_hoverSeries = m_hoverIndex = -1;
    updateBounds();
    update();
}

void TrendChart::setUnit(const QString &unit, int decimals)
{
    m_unit = unit;
    m_decimals = decimals;
    update();
}

void TrendChart::setTimeAxis()
{
    m_timeAxis = true;
    m_categories.clear();
    updateBounds();
    update();
}

void TrendChart::setCategories(const QStringList &labels)
{
    m_timeAxis = false;
    m_categories = labels;
    updateBounds();
    update();
}

void TrendChart::setEmptyText(const QString &text)
{
    m_emptyText = text;
    update();
}

void TrendChart::updateBounds()
{
    bool any = false;
    double xMin = 0, xMax = 1, yMin = 0, yMax = 1;
    for (const auto &s : m_series) {
        for (const auto &p : s.points) {
            if (!any) {
                xMin = xMax = p.x();
                yMin = yMax = p.y();
                any = true;
            }
            xMin = std::min(xMin, p.x());
            xMax = std::max(xMax, p.x());
            yMin = std::min(yMin, p.y());
            yMax = std::max(yMax, p.y());
        }
        // Keep the normal band visible
        if (any && s.bandLow)
            yMin = std::min(yMin, *s.bandLow);
        if (any && s.bandHigh)
            yMax = std::max(yMax, *s.bandHigh);
    }
    if (!m_timeAxis && !m_categories.isEmpty()) {
        xMin = -0.5;
        xMax = m_categories.size() - 0.5;
    }
    if (xMax - xMin < 1e-9)
        xMax = xMin + 1;
    const double pad = std::max((yMax - yMin) * 0.12, 0.5);
    m_xMin = xMin;
    m_xMax = xMax;
    m_yMin = yMin - pad;
    m_yMax = yMax + pad;
}

QRectF TrendChart::plotRect() const
{
    return QRectF(56, 16, width() - 56 - 20, height() - 16 - 40);
}

QPointF TrendChart::toPixel(const QPointF &p) const
{
    const QRectF r = plotRect();
    return {r.left() + (p.x() - m_xMin) / (m_xMax - m_xMin) * r.width(),
            r.bottom() - (p.y() - m_yMin) / (m_yMax - m_yMin) * r.height()};
}

QString TrendChart::xLabel(double x, bool full) const
{
    if (!m_timeAxis) {
        const int i = int(std::lround(x));
        return (i >= 0 && i < m_categories.size()) ? m_categories[i] : QString();
    }
    const QDateTime t = QDateTime::fromMSecsSinceEpoch(qint64(x), QTimeZone::UTC);
    return full ? t.toString(QStringLiteral("d MMM yyyy, HH:mm 'UTC'"))
                : t.toString(QStringLiteral("d MMM"));
}

void TrendChart::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    p.fillRect(rect(), palette().base());

    const bool empty = std::all_of(m_series.begin(), m_series.end(),
                                   [](const Series &s) { return s.points.isEmpty(); });
    if (empty) {
        p.setPen(kAxisText);
        p.drawText(rect(), Qt::AlignCenter | Qt::TextWordWrap,
                   m_emptyText.isEmpty() ? tr("No data") : m_emptyText);
        return;
    }

    const QRectF r = plotRect();
    QFont small = font();
    small.setPointSizeF(font().pointSizeF() * 0.9);
    p.setFont(small);

    // Y grid and labels
    const double yStep = niceStep(m_yMax - m_yMin, 5);
    const int yDecimals = yStep < 1 ? 1 : 0;
    for (double y = std::ceil(m_yMin / yStep) * yStep; y <= m_yMax; y += yStep) {
        const qreal py = toPixel({0, y}).y();
        p.setPen(kGrid);
        p.drawLine(QPointF(r.left(), py), QPointF(r.right(), py));
        p.setPen(kAxisText);
        p.drawText(QRectF(0, py - 8, r.left() - 8, 16), Qt::AlignRight | Qt::AlignVCenter,
                   QString::number(y, 'f', yDecimals));
    }
    if (!m_unit.isEmpty()) {
        p.setPen(kAxisText);
        p.drawText(QRectF(0, 0, r.left() - 8, 14), Qt::AlignRight | Qt::AlignTop, m_unit);
    }

    // X labels
    p.setPen(kAxisText);
    if (m_timeAxis) {
        const int ticks = std::max(2, int(r.width() / 110));
        for (int i = 0; i <= ticks; ++i) {
            const double x = m_xMin + (m_xMax - m_xMin) * i / ticks;
            const qreal px = toPixel({x, 0}).x();
            p.drawText(QRectF(px - 50, r.bottom() + 6, 100, 16), Qt::AlignHCenter,
                       xLabel(x, false));
        }
    } else {
        const int n = int(m_categories.size());
        const int every = std::max(1, int(std::ceil(n * 80.0 / std::max(1.0, r.width()))));
        for (int i = 0; i < n; i += every) {
            const qreal px = toPixel({double(i), 0}).x();
            p.drawText(QRectF(px - 45, r.bottom() + 6, 90, 16), Qt::AlignHCenter,
                       m_categories[i]);
        }
    }

    // Normal range bands
    for (const auto &s : m_series) {
        if (!s.bandLow || !s.bandHigh)
            continue;
        const qreal top = toPixel({0, *s.bandHigh}).y();
        const qreal bottom = toPixel({0, *s.bandLow}).y();
        QColor fill = Health::tint(Health::Status::Normal);
        fill.setAlpha(150);
        p.fillRect(QRectF(r.left(), top, r.width(), bottom - top), fill);
        QPen dash(Health::color(Health::Status::Normal), 1, Qt::DashLine);
        dash.setColor(QColor(21, 128, 61, 110));
        p.setPen(dash);
        p.drawLine(QPointF(r.left(), top), QPointF(r.right(), top));
        p.drawLine(QPointF(r.left(), bottom), QPointF(r.right(), bottom));
    }

    // Lines and status-coloured points
    p.save();
    p.setClipRect(r.adjusted(-6, -6, 6, 6));
    for (int si = 0; si < m_series.size(); ++si) {
        const auto &s = m_series[si];
        if (s.points.isEmpty())
            continue;
        QPainterPath path;
        path.moveTo(toPixel(s.points.first()));
        for (int i = 1; i < s.points.size(); ++i)
            path.lineTo(toPixel(s.points[i]));
        p.setPen(QPen(s.color, 1.8, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
        p.setBrush(Qt::NoBrush);
        p.drawPath(path);

        const bool dense = s.points.size() > 90;
        for (int i = 0; i < s.points.size(); ++i) {
            const auto st = s.classify ? s.classify(s.points[i].y()) : Health::Status::Unknown;
            const bool last = i == s.points.size() - 1;
            if (dense && st == Health::Status::Normal && !last)
                continue;
            const qreal radius = dense ? 2.8 : 3.8;
            p.setPen(QPen(Qt::white, 1.2));
            p.setBrush(st == Health::Status::Normal || st == Health::Status::Unknown
                           ? s.color : Health::color(st));
            p.drawEllipse(toPixel(s.points[i]), radius, radius);
        }
    }
    p.restore();

    // Legend (only for several series)
    if (m_series.size() > 1) {
        qreal x = r.right();
        const QFontMetricsF fm(small);
        for (int i = int(m_series.size()) - 1; i >= 0; --i) {
            const qreal w = fm.horizontalAdvance(m_series[i].name);
            x -= w;
            p.setPen(kText);
            p.drawText(QRectF(x, r.top() + 2, w + 2, 16), Qt::AlignVCenter, m_series[i].name);
            x -= 16;
            p.fillRect(QRectF(x, r.top() + 8, 12, 3), m_series[i].color);
            x -= 14;
        }
    }

    // Hover: crosshair and tooltip card
    if (m_hoverSeries >= 0 && m_hoverIndex >= 0) {
        const auto &s = m_series[m_hoverSeries];
        const QPointF pt = s.points[m_hoverIndex];
        const QPointF px = toPixel(pt);
        p.setPen(QPen(QColor("#94a3b8"), 1, Qt::DotLine));
        p.drawLine(QPointF(px.x(), r.top()), QPointF(px.x(), r.bottom()));

        const auto st = s.classify ? s.classify(pt.y()) : Health::Status::Unknown;
        p.setPen(QPen(Qt::white, 2));
        p.setBrush(Health::color(st == Health::Status::Unknown ? Health::Status::Normal : st));
        p.drawEllipse(px, 6, 6);

        QStringList lines;
        lines << xLabel(pt.x(), true);
        for (const auto &other : m_series) {
            // Show all series at the same x (e.g. systolic and diastolic together)
            for (const auto &q : other.points) {
                if (std::abs(q.x() - pt.x()) < 1e-6) {
                    const auto qs = other.classify ? other.classify(q.y()) : Health::Status::Unknown;
                    lines << QStringLiteral("%1: %2 %3   %4 %5")
                                 .arg(other.name, QString::number(q.y(), 'f', m_decimals), m_unit,
                                      Health::symbol(qs), Health::label(qs));
                    break;
                }
            }
        }
        const QFontMetricsF fm(small);
        qreal w = 0;
        for (const auto &l : lines)
            w = std::max(w, fm.horizontalAdvance(l));
        const QSizeF box(w + 20, lines.size() * 18 + 12);
        QPointF topLeft(px.x() + 12, px.y() - box.height() - 8);
        if (topLeft.x() + box.width() > width() - 4)
            topLeft.setX(px.x() - box.width() - 12);
        topLeft.setY(std::clamp(topLeft.y(), 4.0, height() - box.height() - 4));
        const QRectF card(topLeft, box);
        p.setPen(QColor("#cbd5e1"));
        p.setBrush(Qt::white);
        p.drawRoundedRect(card, 6, 6);
        for (int i = 0; i < lines.size(); ++i) {
            p.setPen(i == 0 ? kAxisText : kText);
            p.drawText(QRectF(card.left() + 10, card.top() + 6 + i * 18, w + 4, 18),
                       Qt::AlignVCenter, lines[i]);
        }
    }
}

void TrendChart::mouseMoveEvent(QMouseEvent *event)
{
    const QPointF pos = event->position();
    int bestS = -1, bestI = -1;
    double bestD = 1e18;
    for (int si = 0; si < m_series.size(); ++si) {
        const auto &pts = m_series[si].points;
        for (int i = 0; i < pts.size(); ++i) {
            const QPointF px = toPixel(pts[i]);
            const double d = std::abs(px.x() - pos.x()) * 4 + std::abs(px.y() - pos.y());
            if (d < bestD) {
                bestD = d;
                bestS = si;
                bestI = i;
            }
        }
    }
    if (!plotRect().adjusted(-10, -10, 10, 10).contains(pos))
        bestS = bestI = -1;
    if (bestS != m_hoverSeries || bestI != m_hoverIndex) {
        m_hoverSeries = bestS;
        m_hoverIndex = bestI;
        update();
    }
}

void TrendChart::leaveEvent(QEvent *)
{
    m_hoverSeries = m_hoverIndex = -1;
    update();
}
