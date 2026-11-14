#include "vitalchart.h"

#include <QLinearGradient>
#include <QPainter>
#include <QPainterPath>

#include <algorithm>
#include <cmath>

namespace {
const QColor kCardBg("#131c2e");
const QColor kCardBorder("#1f2a40");
const QColor kGrid("#1f2a40");
const QColor kMuted("#64748b");
const QColor kLabel("#94a3b8");
const QColor kText("#f8fafc");
const QColor kOk("#34d399");
const QColor kWarn("#fbbf24");
const QColor kCrit("#f87171");

QColor statusColor(VitalChart::Status s)
{
    switch (s) {
    case VitalChart::Status::Critical: return kCrit;
    case VitalChart::Status::Warning:  return kWarn;
    default:                           return kOk;
    }
}

QColor withAlpha(QColor c, int a)
{
    c.setAlpha(a);
    return c;
}

// Smooth curve through points (Catmull-Rom converted to cubic Béziers).
QPainterPath smoothPath(const QVector<QPointF> &pts)
{
    QPainterPath path;
    if (pts.isEmpty())
        return path;
    path.moveTo(pts.first());
    for (int i = 0; i + 1 < pts.size(); ++i) {
        const QPointF p0 = pts[std::max(i - 1, 0)];
        const QPointF p1 = pts[i];
        const QPointF p2 = pts[i + 1];
        const QPointF p3 = pts[std::min(i + 2, int(pts.size()) - 1)];
        path.cubicTo(p1 + (p2 - p0) / 6.0, p2 - (p3 - p1) / 6.0, p2);
    }
    return path;
}
} // namespace

VitalChart::VitalChart(const QString &title, const QString &unit, int decimals,
                       double axisMin, double axisMax, QWidget *parent)
    : QWidget(parent)
    , m_title(title)
    , m_unit(unit)
    , m_decimals(decimals)
    , m_axisMin(axisMin)
    , m_axisMax(axisMax)
{
    setAttribute(Qt::WA_OpaquePaintEvent, false);
}

int VitalChart::addSeries(const QString &name, const QColor &color,
                          double normalLow, double normalHigh, double criticalMargin)
{
    m_series.append({name, color, normalLow, normalHigh, criticalMargin, {}});
    update();
    return int(m_series.size()) - 1;
}

void VitalChart::setValues(int series, const QVector<double> &values)
{
    m_series[series].values = values;
    update();
}

void VitalChart::appendValue(int series, double value, int maxSamples)
{
    auto &v = m_series[series].values;
    v.append(value);
    while (v.size() > maxSamples)
        v.removeFirst();
    update();
}

void VitalChart::setSampleInterval(int seconds)
{
    m_sampleInterval = std::max(1, seconds);
    update();
}

VitalChart::Status VitalChart::seriesStatus(const Series &s) const
{
    if (s.values.isEmpty())
        return Status::Normal;
    const double v = s.values.last();
    if (v < s.normalLow - s.criticalMargin || v > s.normalHigh + s.criticalMargin)
        return Status::Critical;
    if (v < s.normalLow || v > s.normalHigh)
        return Status::Warning;
    return Status::Normal;
}

VitalChart::Status VitalChart::status() const
{
    Status worst = Status::Normal;
    for (const auto &s : m_series)
        worst = std::max(worst, seriesStatus(s));
    return worst;
}

QString VitalChart::formatValue(double v) const
{
    return QString::number(v, 'f', m_decimals);
}

void VitalChart::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    // Card
    const QRectF card = QRectF(rect()).adjusted(0.5, 0.5, -0.5, -0.5);
    p.setPen(kCardBorder);
    p.setBrush(kCardBg);
    p.drawRoundedRect(card, 14, 14);

    const qreal pad = 18;
    const QRectF inner = card.adjusted(pad, pad - 2, -pad, -pad + 4);

    // Title
    QFont titleFont = font();
    titleFont.setPixelSize(13);
    titleFont.setWeight(QFont::DemiBold);
    p.setFont(titleFont);
    p.setPen(kLabel);
    p.drawText(QRectF(inner.left(), inner.top(), inner.width(), 18),
               Qt::AlignLeft | Qt::AlignVCenter, m_title.toUpper());

    // Status pill
    const Status st = status();
    const QString stText = st == Status::Critical ? tr("Critical")
                         : st == Status::Warning  ? tr("Check")
                                                  : tr("Normal");
    QFont pillFont = font();
    pillFont.setPixelSize(12);
    pillFont.setWeight(QFont::DemiBold);
    p.setFont(pillFont);
    const qreal pillW = QFontMetricsF(pillFont).horizontalAdvance(stText) + 30;
    const QRectF pill(inner.right() - pillW, inner.top() - 1, pillW, 22);
    const QColor sc = statusColor(st);
    p.setPen(Qt::NoPen);
    p.setBrush(withAlpha(sc, 38));
    p.drawRoundedRect(pill, 11, 11);
    p.setBrush(sc);
    p.drawEllipse(QPointF(pill.left() + 12, pill.center().y()), 3.5, 3.5);
    p.setPen(sc);
    p.drawText(pill.adjusted(20, 0, -8, 0), Qt::AlignVCenter | Qt::AlignLeft, stText);

    // Current value, e.g. "118/76 mmHg"
    QStringList current;
    for (const auto &s : m_series)
        current << (s.values.isEmpty() ? QStringLiteral("–") : formatValue(s.values.last()));
    QFont valueFont = font();
    valueFont.setPixelSize(30);
    valueFont.setWeight(QFont::Bold);
    p.setFont(valueFont);
    p.setPen(st == Status::Normal ? kText : sc);
    const QString valueText = current.join('/');
    const qreal valueTop = inner.top() + 24;
    const QRectF valueRect(inner.left(), valueTop, inner.width(), 38);
    p.drawText(valueRect, Qt::AlignLeft | Qt::AlignVCenter, valueText);
    const qreal valueW = QFontMetricsF(valueFont).horizontalAdvance(valueText);

    QFont unitFont = font();
    unitFont.setPixelSize(14);
    p.setFont(unitFont);
    p.setPen(kLabel);
    p.drawText(QRectF(inner.left() + valueW + 6, valueTop + 6, 120, 30),
               Qt::AlignLeft | Qt::AlignVCenter, m_unit);

    // Normal range caption on the right of the value row
    QFont smallFont = font();
    smallFont.setPixelSize(11);
    p.setFont(smallFont);
    p.setPen(kMuted);
    QStringList ranges;
    for (const auto &s : m_series)
        ranges << formatValue(s.normalLow) + "–" + formatValue(s.normalHigh);
    p.drawText(QRectF(inner.left(), valueTop + 8, inner.width(), 30),
               Qt::AlignRight | Qt::AlignVCenter, tr("normal %1").arg(ranges.join(" / ")));

    // Chart area
    const qreal footerH = 22;
    const qreal axisLabelW = 34;
    const QRectF chart(inner.left() + axisLabelW, valueTop + 50,
                       inner.width() - axisLabelW,
                       inner.bottom() - footerH - 18 - (valueTop + 50));
    if (chart.height() < 30)
        return;

    // Y range: configured axis, widened if data falls outside it
    double yMin = m_axisMin, yMax = m_axisMax;
    int maxCount = 0;
    for (const auto &s : m_series) {
        maxCount = std::max(maxCount, int(s.values.size()));
        for (double v : s.values) {
            yMin = std::min(yMin, v);
            yMax = std::max(yMax, v);
        }
    }
    const auto yToPx = [&](double v) {
        return chart.bottom() - (v - yMin) / (yMax - yMin) * chart.height();
    };
    const auto xToPx = [&](int i) {
        return maxCount <= 1 ? chart.right()
                             : chart.left() + chart.width() * i / double(maxCount - 1);
    };

    // Grid + Y labels
    p.setFont(smallFont);
    const int gridLines = 4;
    for (int i = 0; i <= gridLines; ++i) {
        const double v = yMin + (yMax - yMin) * i / gridLines;
        const qreal y = yToPx(v);
        p.setPen(QPen(kGrid, 1));
        p.drawLine(QPointF(chart.left(), y), QPointF(chart.right(), y));
        p.setPen(kMuted);
        p.drawText(QRectF(inner.left(), y - 8, axisLabelW - 8, 16),
                   Qt::AlignRight | Qt::AlignVCenter,
                   QString::number(v, 'f', (yMax - yMin) < 8 ? 1 : 0));
    }

    // Normal range bands
    for (const auto &s : m_series) {
        const qreal top = yToPx(std::min(s.normalHigh, yMax));
        const qreal bottom = yToPx(std::max(s.normalLow, yMin));
        p.setPen(Qt::NoPen);
        p.setBrush(withAlpha(s.color, 22));
        p.drawRect(QRectF(chart.left(), top, chart.width(), bottom - top));
        QPen dash(withAlpha(s.color, 90), 1, Qt::DashLine);
        p.setPen(dash);
        p.drawLine(QPointF(chart.left(), top), QPointF(chart.right(), top));
        p.drawLine(QPointF(chart.left(), bottom), QPointF(chart.right(), bottom));
    }

    // Series lines
    p.save();
    p.setClipRect(chart.adjusted(-6, -6, 6, 6));
    for (const auto &s : m_series) {
        if (s.values.isEmpty())
            continue;
        const int offset = maxCount - int(s.values.size());
        QVector<QPointF> pts;
        pts.reserve(s.values.size());
        for (int i = 0; i < s.values.size(); ++i)
            pts.append({xToPx(i + offset), yToPx(s.values[i])});

        const QPainterPath line = smoothPath(pts);

        if (m_series.size() == 1) {
            QPainterPath area = line;
            area.lineTo(pts.last().x(), chart.bottom());
            area.lineTo(pts.first().x(), chart.bottom());
            area.closeSubpath();
            QLinearGradient g(0, chart.top(), 0, chart.bottom());
            g.setColorAt(0, withAlpha(s.color, 70));
            g.setColorAt(1, withAlpha(s.color, 0));
            p.setPen(Qt::NoPen);
            p.setBrush(g);
            p.drawPath(area);
        }

        p.setBrush(Qt::NoBrush);
        p.setPen(QPen(s.color, 2.2, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
        p.drawPath(line);

        // Mark out-of-range samples
        for (int i = 0; i < s.values.size(); ++i) {
            const double v = s.values[i];
            if (v >= s.normalLow && v <= s.normalHigh)
                continue;
            const bool crit = v < s.normalLow - s.criticalMargin
                           || v > s.normalHigh + s.criticalMargin;
            p.setPen(Qt::NoPen);
            p.setBrush(crit ? kCrit : kWarn);
            p.drawEllipse(pts[i], 2.6, 2.6);
        }

        // Latest point
        p.setPen(QPen(kCardBg, 2));
        p.setBrush(s.color);
        p.drawEllipse(pts.last(), 4.5, 4.5);
    }
    p.restore();

    // X labels (relative time)
    p.setFont(smallFont);
    p.setPen(kMuted);
    const int spanSec = std::max(0, maxCount - 1) * m_sampleInterval;
    const auto rel = [](int sec) {
        return sec == 0 ? QObject::tr("now")
                        : QStringLiteral("−%1:%2").arg(sec / 60).arg(sec % 60, 2, 10, QChar('0'));
    };
    const qreal xLabelY = chart.bottom() + 4;
    p.drawText(QRectF(chart.left(), xLabelY, 80, 14), Qt::AlignLeft | Qt::AlignTop, rel(spanSec));
    p.drawText(QRectF(chart.center().x() - 40, xLabelY, 80, 14), Qt::AlignHCenter | Qt::AlignTop,
               rel(spanSec / 2));
    p.drawText(QRectF(chart.right() - 80, xLabelY, 80, 14), Qt::AlignRight | Qt::AlignTop, rel(0));

    // Footer: min / avg / max and, when there's room, a legend for multi-series
    const QRectF footer(inner.left(), inner.bottom() - footerH, inner.width(), footerH);
    QStringList mins, avgs, maxs;
    for (const auto &s : m_series) {
        if (s.values.isEmpty())
            continue;
        const auto [mn, mx] = std::minmax_element(s.values.begin(), s.values.end());
        double sum = 0;
        for (double v : s.values)
            sum += v;
        mins << formatValue(*mn);
        avgs << formatValue(sum / s.values.size());
        maxs << formatValue(*mx);
    }
    const QFontMetricsF smallFm(smallFont);
    QString statsText;
    if (!mins.isEmpty())
        statsText = tr("min %1  ·  avg %2  ·  max %3")
                        .arg(mins.join('/'), avgs.join('/'), maxs.join('/'));
    p.setPen(kLabel);
    p.drawText(footer, Qt::AlignLeft | Qt::AlignVCenter, statsText);

    qreal legendW = 0;
    for (const auto &s : m_series)
        legendW += smallFm.horizontalAdvance(s.name) + 28;
    const bool legendFits = smallFm.horizontalAdvance(statsText) + 16 + legendW <= footer.width();

    if (m_series.size() > 1 && legendFits) {
        qreal x = footer.right();
        for (int i = int(m_series.size()) - 1; i >= 0; --i) {
            const auto &s = m_series[i];
            const qreal w = smallFm.horizontalAdvance(s.name);
            x -= w;
            p.setPen(kLabel);
            p.drawText(QRectF(x, footer.top(), w + 2, footer.height()), Qt::AlignVCenter, s.name);
            x -= 14;
            p.setPen(Qt::NoPen);
            p.setBrush(s.color);
            p.drawRoundedRect(QRectF(x, footer.center().y() - 2, 10, 4), 2, 2);
            x -= 14;
        }
    }
}
