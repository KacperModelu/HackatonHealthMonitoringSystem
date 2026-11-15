// Vital-sign definitions and the green / amber / red colour coding
// (same rule as the v_vitals_alerts view in the database).
export const PARAMS = [
  { key: 'systolic_mmhg', label: 'Systolic BP', unit: 'mmHg', guide: 'systolic_mmhg' },
  { key: 'diastolic_mmhg', label: 'Diastolic BP', unit: 'mmHg', guide: 'systolic_mmhg' },
  { key: 'heart_rate_bpm', label: 'Resting heart rate', unit: 'bpm', guide: 'heart_rate_bpm' },
  { key: 'resp_rate_bpm', label: 'Respiratory rate', unit: '/min', guide: 'resp_rate_bpm' },
  { key: 'skin_temp_c', label: 'Skin temperature', unit: '°C', guide: 'skin_temp_c' },
  { key: 'spo2_pct', label: 'Blood oxygen (SpO₂)', unit: '%', guide: 'spo2_pct' },
];

// Each range row has two bands: normal_low..normal_high and the wider
// critical_low..critical_high. Inside normal → 'ok' (green); outside normal but inside
// critical → 'warning' (amber); outside critical → 'critical' (red). A missing limit
// (null) is simply not checked. Critical is tested first because it is the wider band.
export function classify(value, range) {
  if (value == null || !range) return 'none';
  const { normal_low: nl, normal_high: nh, critical_low: cl, critical_high: ch } = range;
  if ((cl != null && value < cl) || (ch != null && value > ch)) return 'critical';
  if ((nl != null && value < nl) || (nh != null && value > nh)) return 'warning';
  return 'ok';
}

// Colour for a change of VO2peak vs the preflight test, in percent (negative = loss).
// The one place for these thresholds: a drop of more than 10% is amber, more than 20%
// is red. The Guide text (indicator_guide, topic 'vo2peak') quotes the same numbers.
export const fitnessStatus = (pct) =>
  (pct == null ? 'none' : pct < -20 ? 'critical' : pct < -10 ? 'warning' : 'ok');

// Normal ranges of the resting ECG intervals in ms: [low, high].
// QTc is naturally longer in women, so their upper limit is 460 ms instead of 450.
export const ecgLimits = (sex) => ({
  pr_ms: [120, 200],
  qrs_ms: [70, 110],
  qtc_ms: [350, sex === 'F' ? 460 : 450],
});

export const STATUS_TEXT = {
  ok: 'Normal',
  warning: 'Check again',
  critical: 'Contact flight surgeon',
  none: 'No data',
};

// reference_range rows → { systolic_mmhg: {...}, ... } for quick lookup by parameter.
export const rangeMap = (ranges) => Object.fromEntries(ranges.map((r) => [r.parameter, r]));

// Number for display: "–" when missing; whole numbers stay whole unless digits are asked for.
export const fmt = (v, digits = 0) =>
  v == null ? '–' : Number(v).toFixed(Number.isInteger(v) && digits === 0 ? 0 : digits);
