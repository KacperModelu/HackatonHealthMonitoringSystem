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

export function classify(value, range) {
  if (value == null || !range) return 'none';
  const { normal_low: nl, normal_high: nh, critical_low: cl, critical_high: ch } = range;
  if ((cl != null && value < cl) || (ch != null && value > ch)) return 'critical';
  if ((nl != null && value < nl) || (nh != null && value > nh)) return 'warning';
  return 'ok';
}

export const STATUS_TEXT = {
  ok: 'Normal',
  warning: 'Check again',
  critical: 'Contact flight surgeon',
  none: 'No data',
};

export const rangeMap = (ranges) => Object.fromEntries(ranges.map((r) => [r.parameter, r]));

export const fmt = (v, digits = 0) =>
  v == null ? '–' : Number(v).toFixed(Number.isInteger(v) && digits === 0 ? 0 : digits);
