import { useEffect, useMemo, useRef, useState } from 'react';
import * as sat from 'satellite.js';
import { feature } from 'topojson-client';
import { geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo';
import landTopo from 'world-atlas/land-110m.json';
import { api } from '../api.js';
import { go } from '../router.js';

// Live satellite map. Orbital elements (TLE) come from CelesTrak through our server
// (/api/satellites, cached there); positions are computed in the browser with the
// SGP4 model (satellite.js) once a second and drawn on a flat world map
// (longitude -> x, latitude -> y), with the night side shaded.

const land = feature(landTopo, landTopo.objects.land);
const TICK_MS = 1000;
const HIT_PX = 10;                 // how close (in CSS pixels) a click must be to a satellite
const ISS = '25544';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const noradId = (line1) => line1.slice(2, 7).trim();
const periodMin = (line2) => 1440 / Number(line2.slice(52, 63));

// Latitude, longitude (degrees), altitude (km) and speed (km/s) at `date`, or null
// when SGP4 cannot propagate (e.g. a decayed object).
function locate(satrec, date) {
  const pv = sat.propagate(satrec, date);
  if (!pv.position || typeof pv.position === 'boolean') return null;
  const geo = sat.eciToGeodetic(pv.position, sat.gstime(date));
  const v = pv.velocity;
  return {
    lat: deg(geo.latitude),
    lon: deg(geo.longitude),
    alt: geo.height,
    speed: Math.hypot(v.x, v.y, v.z),
  };
}

// Point on Earth where the Sun is overhead (low-precision almanac formula, ~0.01°).
function subsolar(date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;   // days since J2000
  const L = rad(280.46 + 0.9856474 * n);
  const g = rad(357.528 + 0.9856003 * n);
  const lambda = L + rad(1.915) * Math.sin(g) + rad(0.02) * Math.sin(2 * g);
  const eps = rad(23.439 - 0.0000004 * n);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  let lon = deg(ra - sat.gstime(date));
  lon = ((lon + 540) % 360) - 180;
  return { lat: deg(dec), lon };
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function Satellites() {
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState('stations');
  const [data, setData] = useState(null);        // { fetchedAt, stale, satellites }
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(ISS);
  const [info, setInfo] = useState(null);        // live position of the selected satellite
  const [hover, setHover] = useState(null);      // { name, x, y } tooltip
  const [query, setQuery] = useState('');

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const baseRef = useRef(null);       // offscreen canvas with ocean, land and grid
  const sizeRef = useRef({ w: 0, h: 0 });
  const pointsRef = useRef([]);       // last drawn positions: [{ id, name, x, y }]

  useEffect(() => {
    api.satelliteGroups().then((r) => setGroups(r.groups)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    api.satellites(group)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [group]);

  // Parsed orbits for the loaded group.
  const sats = useMemo(() => (data?.satellites ?? []).map((s) => {
    try {
      return { id: noradId(s.line1), name: s.name, period: periodMin(s.line2), satrec: sat.twoline2satrec(s.line1, s.line2) };
    } catch {
      return null;
    }
  }).filter(Boolean), [data]);

  const selected = sats.find((s) => s.id === selectedId) ?? null;

  // Draws the static layer (ocean, graticule, land) into an offscreen canvas.
  const drawBase = () => {
    const { w, h } = sizeRef.current;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    const base = baseRef.current ?? (baseRef.current = document.createElement('canvas'));
    base.width = w * dpr;
    base.height = h * dpr;
    const ctx = base.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = (lon) => ((lon + 180) / 360) * w;
    const y = (lat) => ((90 - lat) / 180) * h;

    ctx.fillStyle = cssVar('--surface-2');
    ctx.fillRect(0, 0, w, h);

    // d3-geo projects the land and clips polygons that cross the date line.
    const projection = geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]);
    const path = geoPath(projection, ctx);

    ctx.strokeStyle = cssVar('--border');
    ctx.lineWidth = 1;
    ctx.beginPath();
    path(geoGraticule10());
    ctx.stroke();

    ctx.fillStyle = cssVar('--muted');
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    path(land);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  // Draws one frame: base layer, night side, ground track and satellites.
  const drawFrame = () => {
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || !w || !baseRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(baseRef.current, 0, 0, w, h);
    const x = (lon) => ((lon + 180) / 360) * w;
    const y = (lat) => ((90 - lat) / 180) * h;
    const now = new Date();

    // Night: for each longitude the terminator latitude is where the Sun is on the horizon.
    const sun = subsolar(now);
    const dec = rad(Math.abs(sun.lat) < 0.1 ? (sun.lat < 0 ? -0.1 : 0.1) : sun.lat);
    ctx.fillStyle = 'rgba(0, 10, 30, 0.28)';
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 2) {
      const lat = deg(Math.atan(-Math.cos(rad(lon - sun.lon)) / Math.tan(dec)));
      lon === -180 ? ctx.moveTo(x(lon), y(lat)) : ctx.lineTo(x(lon), y(lat));
    }
    const pole = dec > 0 ? h : 0;   // northern summer: the night side contains the south pole
    ctx.lineTo(w, pole);
    ctx.lineTo(0, pole);
    ctx.closePath();
    ctx.fill();

    // Sun marker.
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(x(sun.lon), y(sun.lat), 5, 0, 2 * Math.PI);
    ctx.fill();

    const accent = cssVar('--accent');
    const highlight = cssVar('--critical');

    // Ground track of the selected satellite: one orbit back (faint) and one ahead.
    if (selected) {
      const span = Math.min(selected.period || 95, 1440);
      const steps = 180;
      for (const [from, to, alpha] of [[-span, 0, 0.35], [0, span, 0.9]]) {
        ctx.strokeStyle = highlight;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let prev = null;
        for (let i = 0; i <= steps; i++) {
          const p = locate(selected.satrec, new Date(now.getTime() + (from + ((to - from) * i) / steps) * 60000));
          if (!p) { prev = null; continue; }
          // A jump of more than half the map means the track crossed the date line.
          if (prev && Math.abs(p.lon - prev.lon) < 180) ctx.lineTo(x(p.lon), y(p.lat));
          else ctx.moveTo(x(p.lon), y(p.lat));
          prev = p;
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Satellites.
    const points = [];
    // Few satellites: large dots; thousands (Starlink): small ones, smaller still on phones.
    const dot = sats.length < 300 ? 5 : w < 600 ? 1 : 2;
    ctx.fillStyle = accent;
    for (const s of sats) {
      const p = locate(s.satrec, now);
      if (!p) continue;
      const px = x(p.lon), py = y(p.lat);
      points.push({ id: s.id, name: s.name, x: px, y: py });
      if (s.id === selectedId) continue;
      ctx.fillRect(px - dot / 2, py - dot / 2, dot, dot);
    }
    pointsRef.current = points;

    if (selected) {
      const p = locate(selected.satrec, now);
      if (p) {
        const px = x(p.lon), py = y(p.lat);
        ctx.fillStyle = highlight;
        ctx.strokeStyle = cssVar('--surface');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.fillStyle = cssVar('--text');
        ctx.textAlign = px > w - 120 ? 'right' : 'left';
        ctx.fillText(selected.name, px + (px > w - 120 ? -10 : 10), py - 8);
      }
      setInfo(p);
    } else {
      setInfo(null);
    }
  };

  // Always call the newest drawFrame (it reads the current satellites and selection).
  const frameRef = useRef(drawFrame);
  frameRef.current = drawFrame;

  // Keep the canvas as wide as its card, at a 2:1 ratio (360° x 180°).
  useEffect(() => {
    const wrap = wrapRef.current;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = Math.round(w / 2);
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w, h };
      const c = canvasRef.current;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.height = `${h}px`;
      drawBase();
      frameRef.current();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const retheme = () => { drawBase(); frameRef.current(); };
    mq.addEventListener('change', retheme);
    return () => { ro.disconnect(); mq.removeEventListener('change', retheme); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw now and then once a second while this screen is open.
  useEffect(() => {
    drawFrame();
    const t = setInterval(drawFrame, TICK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sats, selectedId]);

  const nearest = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bestD = HIT_PX;
    for (const p of pointsRef.current) {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d <= bestD) { best = p; bestD = d; }
    }
    return best;
  };

  const pick = (e) => {
    const p = nearest(e);
    if (p) setSelectedId(p.id);
  };

  const onMove = (e) => {
    const p = nearest(e);
    setHover(p ? { name: p.name, x: p.x, y: p.y } : null);
  };

  const onSearch = (value) => {
    setQuery(value);
    const match = sats.find((s) => s.name.toLowerCase() === value.trim().toLowerCase());
    if (match) setSelectedId(match.id);
  };

  const fmt = (v, d = 1) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const updated = data && new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <h1>Satellite tracker</h1>
          <p className="muted small">Live positions from CelesTrak orbital data, computed with SGP4.</p>
        </div>
        <button onClick={() => go('/')}>← Back to login</button>
      </header>

      <section className="card">
        <div className="row sat-controls">
          <label className="field">
            <span>Group</span>
            <select value={group} onChange={(e) => { setGroup(e.target.value); setQuery(''); }}>
              {groups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Find satellite</span>
            <input list="sat-names" value={query} placeholder="Type a name…"
              onChange={(e) => onSearch(e.target.value)} disabled={!sats.length} />
            <datalist id="sat-names">
              {sats.slice(0, 500).map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        <p className="muted small" aria-live="polite">
          {!data && !error && 'Loading satellites…'}
          {data && `${sats.length} satellites · data updated ${updated}`}
          {data?.stale && ' (CelesTrak unavailable, showing the last copy)'}
        </p>

        <div ref={wrapRef} className="sat-map">
          <canvas ref={canvasRef} onClick={pick} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
            role="img" aria-label="World map with current satellite positions"
            style={{ cursor: hover ? 'pointer' : 'default' }} />
          {hover && <span className="sat-tip" style={{ left: hover.x, top: hover.y }}>{hover.name}</span>}
        </div>
        <p className="muted small">Click a satellite to follow it. Shaded area: night side; yellow dot: the Sun overhead.</p>
      </section>

      {selected && (
        <section className="card">
          <h2>{selected.name}</h2>
          {info ? (
            <div className="tiles">
              <div className="tile neutral"><span className="small">Latitude</span><strong>{fmt(info.lat, 2)}°</strong></div>
              <div className="tile neutral"><span className="small">Longitude</span><strong>{fmt(info.lon, 2)}°</strong></div>
              <div className="tile neutral"><span className="small">Altitude</span><strong>{fmt(info.alt, 0)} km</strong></div>
              <div className="tile neutral"><span className="small">Speed</span><strong>{fmt(info.speed, 2)} km/s</strong></div>
              <div className="tile neutral"><span className="small">Orbit period</span><strong>{fmt(selected.period, 1)} min</strong></div>
              <div className="tile neutral"><span className="small">NORAD ID</span><strong>{selected.id}</strong></div>
            </div>
          ) : <p className="muted">Position cannot be computed from the current orbital data.</p>}
        </section>
      )}
    </main>
  );
}
