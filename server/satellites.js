// Orbital elements (TLE) from CelesTrak, fetched by the server and cached.
// CelesTrak updates its data about every 2 hours and asks clients not to download
// the same group more often than that, so every group is cached for 2 hours and
// all browsers share the cache. If a refresh fails, the last good copy is served.

export const SATELLITE_GROUPS = [
  { code: 'stations', name: 'Space stations' },
  { code: 'visual', name: '100 brightest' },
  { code: 'weather', name: 'Weather' },
  { code: 'gps-ops', name: 'GPS' },
  { code: 'galileo', name: 'Galileo' },
  { code: 'science', name: 'Science' },
  { code: 'geo', name: 'Geostationary' },
  { code: 'starlink', name: 'Starlink' },
];

const TTL_MS = 2 * 60 * 60 * 1000;
const cache = new Map();   // group code -> { fetchedAt, satellites }

// CelesTrak's 3-line format: name, line 1, line 2 for every satellite.
export function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      out.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] });
      i += 2;
    }
  }
  return out;
}

// Returns { group, fetchedAt, stale, satellites: [{name, line1, line2}] }.
// `fetchImpl` can be replaced in tests.
export async function getGroup(code, fetchImpl = fetch) {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return { group: code, ...hit, stale: false };
  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(code)}&FORMAT=tle`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    const satellites = res.ok ? parseTle(text) : [];
    // CelesTrak answers some errors with a plain-text message and status 200.
    if (!satellites.length) throw new Error(text.trim().slice(0, 200) || `CelesTrak returned ${res.status}`);
    const entry = { fetchedAt: Date.now(), satellites };
    cache.set(code, entry);
    return { group: code, ...entry, stale: false };
  } catch (e) {
    if (hit) return { group: code, ...hit, stale: true };
    throw new Error(`Could not load satellite data from CelesTrak: ${e.message}`);
  }
}
