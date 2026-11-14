#include "healthstatus.h"

#include <QHash>
#include <QObject>

#include <algorithm>

namespace Health {

namespace {
QHash<QString, CardioDb::ReferenceRange> &ranges()
{
    static QHash<QString, CardioDb::ReferenceRange> r;
    return r;
}
} // namespace

void loadRanges()
{
    ranges().clear();
    for (const auto &r : CardioDb::referenceRanges())
        ranges().insert(r.parameter, r);
}

std::optional<CardioDb::ReferenceRange> range(const QString &parameter)
{
    const auto it = ranges().constFind(parameter);
    if (it == ranges().constEnd())
        return std::nullopt;
    return *it;
}

Status classify(const QString &parameter, double value)
{
    const auto r = range(parameter);
    if (!r)
        return Status::Unknown;
    if ((r->criticalLow && value < *r->criticalLow) || (r->criticalHigh && value > *r->criticalHigh))
        return Status::Critical;
    if ((r->normalLow && value < *r->normalLow) || (r->normalHigh && value > *r->normalHigh))
        return Status::Warning;
    return Status::Normal;
}

Status worst(Status a, Status b)
{
    return std::max(a, b);
}

Status classifyVo2Change(double percentChange)
{
    if (percentChange < -25)
        return Status::Critical;
    if (percentChange < -15)
        return Status::Warning;
    return Status::Normal;
}

QColor color(Status s)
{
    switch (s) {
    case Status::Normal:   return QColor("#15803d");
    case Status::Warning:  return QColor("#b45309");
    case Status::Critical: return QColor("#b91c1c");
    default:               return QColor("#64748b");
    }
}

QColor tint(Status s)
{
    switch (s) {
    case Status::Normal:   return QColor("#dcfce7");
    case Status::Warning:  return QColor("#fef3c7");
    case Status::Critical: return QColor("#fee2e2");
    default:               return QColor("#f1f5f9");
    }
}

QString label(Status s)
{
    switch (s) {
    case Status::Normal:   return QObject::tr("Normal");
    case Status::Warning:  return QObject::tr("Check");
    case Status::Critical: return QObject::tr("Alert");
    default:               return QObject::tr("No data");
    }
}

QString symbol(Status s)
{
    switch (s) {
    case Status::Normal:   return QStringLiteral("✓");
    case Status::Warning:  return QStringLiteral("!");
    case Status::Critical: return QStringLiteral("✕");
    default:               return QStringLiteral("–");
    }
}

QString advice(Status s)
{
    switch (s) {
    case Status::Normal:
        return QObject::tr("Within the normal range. Keep up your routine.");
    case Status::Warning:
        return QObject::tr("Slightly outside the normal range. Re-measure sitting still and "
                           "watch the trend.");
    case Status::Critical:
        return QObject::tr("Far outside the normal range. Re-measure now; if it stays red, "
                           "contact the flight surgeon.");
    default:
        return QObject::tr("No measurements yet. See the Guide tab for how to measure.");
    }
}

QString normalRangeText(const QString &parameter, int decimals)
{
    const auto r = range(parameter);
    if (!r)
        return {};
    const auto num = [decimals](double v) { return QString::number(v, 'f', decimals); };
    if (r->normalLow && r->normalHigh)
        return QStringLiteral("%1–%2 %3").arg(num(*r->normalLow), num(*r->normalHigh), r->unit);
    if (r->normalLow)
        return QStringLiteral("≥ %1 %2").arg(num(*r->normalLow), r->unit);
    if (r->normalHigh)
        return QStringLiteral("≤ %1 %2").arg(num(*r->normalHigh), r->unit);
    return {};
}

} // namespace Health
