import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

export default function Login({ selected }) {
  const [crew, setCrew] = useState(null);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  const load = async (select) => {
    try {
      const list = await api.crew();
      setCrew(list);
      const keep = list.find((c) => c.id === select);
      setCurrent(String(keep ? keep.id : list[0]?.id ?? ''));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(selected); }, [selected]);

  // Płynna animacja EKG z okresowym „szaleństwem” (czerwony alarm)
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
    let isGlitching = false;

    // Co 5 sekund włączamy „szaleństwo” na 1.5 sekundy
    const glitchInterval = setInterval(() => {
      isGlitching = true;
      setTimeout(() => {
        isGlitching = false;
      }, 1500);
    }, 5000);

    const render = () => {
      // W trakcie szaleństwa linia przyspiesza
      progress += isGlitching ? 6 : 2;
      ctx.clearRect(0, 0, width, height);

      // Kolory i parametry zmieniają się podczas alertu
      ctx.strokeStyle = isGlitching ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.28)';
      ctx.lineWidth = isGlitching ? 3 : 2.5;
      ctx.shadowBlur = isGlitching ? 15 : 10;
      ctx.shadowColor = isGlitching ? '#ef4444' : '#10b981';

      ctx.beginPath();
      const centerY = height / 2;

      for (let x = 0; x < width; x += 1.5) {
        const waveX = (x + progress) % 500;
        let y = centerY;

        // Podczas szaleństwa piki stają się gwałtowne i wysokie
        const amplitudeFactor = isGlitching ? 2.2 : 1;

        if (waveX > 120 && waveX < 150) {
          y -= Math.sin(((waveX - 120) / 30) * Math.PI) * (30 * amplitudeFactor);
        } else if (waveX >= 180 && waveX <= 195) {
          y += 20 * amplitudeFactor;
        } else if (waveX > 195 && waveX < 210) {
          y -= (isGlitching ? 220 : 120); // Ogromny pik QRS podczas anomalii
        } else if (waveX >= 210 && waveX <= 225) {
          y += 45 * amplitudeFactor;
        } else if (waveX > 280 && waveX < 330) {
          y -= Math.sin(((waveX - 280) / 50) * Math.PI) * (35 * amplitudeFactor);
        }

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      clearInterval(glitchInterval);
    };
  }, []);

  const person = crew?.find((c) => String(c.id) === current);

  const remove = async () => {
    if (!person) return;
    if (!window.confirm(`Delete ${person.name} and all generated health data? This cannot be undone.`)) return;
    try {
      await api.deleteCrew(person.id);
      await load(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const option = (c) => (
    <option key={c.id} value={c.id}>
      {c.name}{c.mission ? ` · ${c.mission}` : ''}
    </option>
  );

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

        /* Przycisk satelitów w prawym górnym rogu */
        .top-right-satellites {
          position: absolute;
          top: 1.75rem;
          right: 2rem;
          z-index: 20;
          background: #111827;
          border: 1px solid #1f2937;
          color: #10b981;
          padding: 0.65rem 1.25rem;
          border-radius: 6px;
          font-size: 0.9rem;
          font-weight: 500;
          letter-spacing: 0.3px;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5);
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .top-right-satellites:hover {
          background: #1f2937;
          border-color: #10b981;
          color: #34d399;
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.25);
        }

        .login-card-wrapper {
          z-index: 10;
          width: 100%;
          max-width: 440px;
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

        .brand-mark {
          color: #10b981;
          font-size: 1.4rem;
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

        .select-wrapper {
          position: relative;
        }

        select {
          appearance: none;
          width: 100%;
          background: #0b0f19;
          border: 1px solid #374151;
          color: #f3f4f6;
          padding: 0.75rem 2.5rem 0.75rem 1rem;
          border-radius: 6px;
          font-family: inherit;
          font-size: 0.95rem;
          outline: none;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
        }

        select:hover {
          border-color: #4b5563;
        }

        select:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
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

        .muted {
          color: #9ca3af;
          font-size: 0.85rem;
          margin-bottom: 1.5rem;
        }

        .error {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 0.5rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-size: 0.85rem;
        }

        .stack {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        button {
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

        button.danger {
          background: transparent;
          border-color: rgba(239, 68, 68, 0.4);
          color: #ef4444;
        }

        button.danger:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.1);
          border-color: #ef4444;
        }
      `}</style>

      <div className="sci-fi-bg">
        <button className="top-right-satellites" onClick={() => go('/satellites')}>
          Satellite Visualisation
        </button>

        <canvas ref={canvasRef} className="ecg-canvas" />

        <section className="login-card-wrapper">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">✦</span>
            <h1>Health Monitor</h1>
          </div>

          <label className="field">
            <span>Choose an astronaut:</span>
            <div className="select-wrapper">
              <select value={current} onChange={(e) => setCurrent(e.target.value)} disabled={!crew?.length}>
                {crew && !crew.length && <option value="">No astronauts yet</option>}
                {crew?.map(option)}
              </select>
              <span className="select-arrow">▼</span>
            </div>
          </label>
          
          {person && (
            <p className="muted">
              {person.age} years · {person.sex === 'F' ? 'Woman' : 'Man'}
              {person.mission ? ` · last mission ${person.mission}` : ' · annual tests only'}
            </p>
          )}

          {error && <p className="error">{error}</p>}

          <div className="stack">
            <button className="primary" disabled={!person} onClick={() => go(`/crew/${person.id}`)}>
              Log in
            </button>
            <button onClick={() => go('/new')}>Add user</button>
            <button className="danger" disabled={!person} onClick={remove}>
              Delete user
            </button>
          </div>
        </section>
      </div>
    </>
  );
}