#ifndef HEALTHSTATUS_H
#define HEALTHSTATUS_H

#include "cardiodb.h"

#include <QColor>
#include <QString>

// Colour coding of health indicators against the reference ranges stored in
// the database. Every status has a colour, a symbol and a word, so the
// meaning never depends on colour alone.
namespace Health {

enum class Status { Unknown, Normal, Warning, Critical };

// Loads reference ranges from the database (call once after opening it).
void loadRanges();
std::optional<CardioDb::ReferenceRange> range(const QString &parameter);

Status classify(const QString &parameter, double value);
Status worst(Status a, Status b);

// VO2peak: % change against the preflight baseline (guide: > 15 % drop = act).
Status classifyVo2Change(double percentChange);

QColor color(Status s);      // strong colour for text, lines and dots
QColor tint(Status s);       // light background
QString label(Status s);     // "Normal", "Check", "Alert"
QString symbol(Status s);    // ✓ ! ✕
QString advice(Status s);    // one sentence of what to do

// "90–130 mmHg"
QString normalRangeText(const QString &parameter, int decimals = 0);

} // namespace Health

#endif // HEALTHSTATUS_H
