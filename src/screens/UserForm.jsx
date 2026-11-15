import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { go } from '../router.js';

const EMPTY = { firstName: '', lastName: '', age: '', sex: '', heightCm: '', weightKg: '' };
const LABELS = {
  firstName: 'name', lastName: 'surname', age: 'age', sex: 'biological sex', heightCm: 'height', weightKg: 'weight',
};

export default function UserForm() {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState([]);
  const [result, setResult] = useState(null);
  const canvasRef = useRef(null);

  // Spójna animacja EKG w tle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    let progress = 0;
    let lastTime = performance.now();
    let glitchIntensity = 0;
    let targetGlitch = 0;
    let glitchTimer = 0;

    const render = (currentTime) => {
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      glitchTimer += deltaTime;
      if (glitchTimer > 6) {
        glitchTimer = 0;
        targetGlitch = targetGlitch === 0 ? 1 : 0;
      }

      const interpSpeed = 1.5;
      glitchIntensity += (targetGlitch - glitchIntensity) * (deltaTime * interpSpeed);

      const speed = 140 + glitchIntensity * 160;
      progress += speed * deltaTime;

      ctx.clearRect(0, 0, width, height);

      const r = Math.round(16 + glitchIntensity * (239 - 16));
      const g = Math.round(185 + glitchIntensity * (68 - 185));
      const b = Math.round(129 + glitchIntensity * (68 - 129));
      const alpha = 0.28 + glitchIntensity * 0.2;

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.lineWidth = 2.5 + glitchIntensity * 1.0;
      ctx.shadowBlur = 10 + glitchIntensity * 10;
      ctx.shadowColor = glitchIntensity > 0.5 ? '#ef4444' : '#10b981';

      ctx.beginPath();
      const centerY = height / 2;

      for (let x = 0; x < width; x += 1.5) {
        const waveX = (x + progress) % 550;
        let y = centerY;
        const amp = 1 + glitchIntensity * 1.2;

        if (waveX > 120 && waveX < 150) {
          y -= Math.sin(((waveX - 120) / 30) * Math.PI) * (30 * amp);
        } else if (waveX >= 180 && waveX <= 195) {
          y += 20 * amp;
        } else if (waveX > 195 && waveX < 210) {
          y -= (120 + glitchIntensity * 110);
        } else if (waveX >= 210 && waveX <= 225) {
          y += 45 * amp;
        } else if (waveX > 280 && waveX < 340) {
          y -= Math.sin(((waveX - 280) / 60) * Math.PI) * (35 * amp);
        }

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    setInvalid(invalid.filter((k) => k !== key));
  };
  
  const req = (key) => ({ value: form[key], onChange: set(key), required: true, 'aria-invalid': invalid.includes(key) });

  const submit = async (e) => {
    e.preventDefault();

    const missing = Object.keys(LABELS).filter((k) => !form[k].trim());
    if (missing.length) {
      setInvalid(missing);
      setError(`Please fill in: ${missing.map((k) => LABELS[k]).join(', ')}.`);
      return;
    }
    setError('');
    setBusy(true);
    try {
      setResult(await api.createCrew(form));
    } catch (err) {
      setError(err.message);
      setInvalid(err.fields ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{`
        .sci-fi-bg {
          background: #0b0f19;
          min-height: 100vh;
          margin: 0;
          color: #f3f4f6;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 2rem 1rem;
        }

        .ecg-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 1;
          pointer-events: none;
        }

        .login-card-wrapper {
          z-index: 10;
          width: 100%;
          max-width: 480px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
          padding: 2.5rem;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }



        .brand h1 {
          font-size: 1.3rem;
          font-weight: 600;
          margin: 0;
          color: #f9fafb;
          letter-spacing: -0.025em;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .field span {
          font-size: 0.85rem;
          font-weight: 500;
          color: #9ca3af;
        }

        input, select {
          appearance: none;
          width: 100%;
          background: #0b0f19;
          border: 1px solid #374151;
          color: #f3f4f6;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-family: inherit;
          font-size: 0.95rem;
          outline: none;
          transition: all 0.15s ease;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
        }

        input:hover, select:hover {
          border-color: #4b5563;
        }

        input:focus, select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        }

        input[aria-invalid="true"], select[aria-invalid="true"] {
          border-color: #ef4444;
        }

        .select-wrapper {
          position: relative;
        }

        .select-arrow {
          position: absolute;
          right: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: #9ca3af;
          pointer-events: none;
          font-size: 0.8rem;
        }

        .grid2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }

        .muted {
          color: #9ca3af;
          font-size: 0.85rem;
          margin-bottom: 1.5rem;
          display: block;
        }

        .error {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 0.75rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-size: 0.85rem;
        }

        .pill {
          padding: 0.5rem 0.75rem;
          border-radius: 6px;
          font-size: 0.85rem;
          margin-bottom: 1rem;
          display: block;
        }

        .pill.warning {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .pill.ok {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #10b981;
        }

        .facts {
          list-style: none;
          padding: 0;
          margin: 1rem 0;
          font-size: 0.9rem;
          color: #d1d5db;
        }

        .facts li {
          margin-bottom: 0.5rem;
        }

        .events {
          list-style: none;
          padding: 0;
          margin: 0.5rem 0 1.5rem 0;
          font-size: 0.85rem;
          color: #9ca3af;
        }

        .events li {
          margin-bottom: 0.3rem;
        }

        .row {
          display: flex;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }

        button {
          flex: 1;
          background: #1f2937;
          border: 1px solid #374151;
          color: #f3f4f6;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-family: inherit;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        button:hover:not(:disabled) {
          background: #4b5563;
          border-color: #6b7280;
        }

        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        button.primary {
          background: #10b981;
          border-color: #10b981;
          color: #0b0f19;
          font-weight: 600;
        }

        button.primary:hover:not(:disabled) {
          background: #059669;
          border-color: #059669;
        }
      `}</style>

      <div className="sci-fi-bg">
        <canvas ref={canvasRef} className="ecg-canvas" />

        <motion.div 
          className="login-card-wrapper"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {result ? (
            <div>
              <div className="brand">
                 s
                <h1 id="done-title">Data generated</h1>
              </div>
              <p className="muted">
                Generated data for <strong>{form.firstName} {form.lastName}</strong> (crew id {result.crewId},
                mission {result.mission}):
              </p>
              <ul className="facts">
                <li><strong>{result.vitalsReadings}</strong> vitals readings (twice a day during a flight)</li>
                <li><strong>{result.cycleTests}</strong> cycle ergometer tests</li>
                <li><strong>{result.ecgs}</strong> resting ECGs</li>
                <li><strong>{result.taskCompletions}</strong> completed daily tasks in the generated history</li>
              </ul>
              {result.severeOutlier && (
                <p className="pill warning">A severe health scenario was randomly generated (20% chance).</p>
              )}
              {result.events.length === 0 ? (
                <p className="pill ok">No deviations from the norm were simulated (healthy profile).</p>
              ) : (
                <>
                  <span className="field" style={{ marginBottom: '0.5rem' }}><span>Simulated deviations from the norm</span></span>
                  <ul className="events">
                    {result.events.map((ev) => (
                      <li key={ev.kind}>
                        {ev.text}
                        {ev.start && <span className="muted"> · flight days {ev.start}–{ev.end}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="row">
                <button className="primary" onClick={() => go(`/?selected=${result.crewId}`)}>OK</button>
                <button onClick={() => go(`/crew/${result.crewId}`)}>Open dashboard</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="brand">
                
                <h1>Health Monitor System</h1>
              </div>
              <span className="muted">All fields are required.</span>

              <div className="grid2">
                <label className="field">
                  <span>Name</span>
                  <input {...req('firstName')} autoFocus autoComplete="off" />
                </label>
                <label className="field">
                  <span>Surname</span>
                  <input {...req('lastName')} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Age</span>
                  <input {...req('age')} inputMode="numeric" placeholder="18–99" />
                </label>
                <label className="field">
                  <span>Biological sex</span>
                  <div className="select-wrapper">
                    <select {...req('sex')}>
                      <option value="" disabled>Choose…</option>
                      <option value="M">Man</option>
                      <option value="F">Woman</option>
                    </select>
                    <span className="select-arrow">▼</span>
                  </div>
                </label>
                <label className="field">
                  <span>Height <em className="muted" style={{ display: 'inline', margin: 0 }}>(cm)</em></span>
                  <input {...req('heightCm')} inputMode="decimal" placeholder="120–230" />
                </label>
                <label className="field">
                  <span>Weight <em className="muted" style={{ display: 'inline', margin: 0 }}>(kg)</em></span>
                  <input {...req('weightKg')} inputMode="decimal" placeholder="35–200" />
                </label>
              </div>

              {error && <p className="error" role="alert">{error}</p>}

              <div className="row">
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? 'Generating…' : 'Generate user data'}
                </button>
                <button type="button" onClick={() => go('/')}>Cancel</button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </>
  );
}