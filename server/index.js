// Entry point: API under /api, React app from Vite (dev) or dist/ (production).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from './api.js';

// Project root (one level above server/), so paths work from any working directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const production = process.env.NODE_ENV === 'production';

// One shared, synchronous SQLite connection for the whole process (see db.js).
const db = openDb();
const app = express();
// The raw http server is created by hand so Vite's live-reload websocket can
// attach to the same server (and therefore the same port) as the app.
const server = http.createServer(app);
// The API is mounted first, so /api/... never falls through to the React app.
app.use('/api', createApi(db));

// NOTE: this file and the rest of server/ are loaded once at start-up. Vite only
// hot-reloads the React code in src/; after changing server code, restart the process.
if (production) {
  // Production: serve the files built by `npm run build`; any unknown path returns
  // index.html so the single-page app can handle it.
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  // Development: Vite runs inside this Express app as middleware. It compiles JSX on
  // request and pushes changes to the browser. Imported lazily so production never loads it.
  const { createServer } = await import('vite');
  // Live reload runs on the same port as the app, so only one port is needed.
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use (another copy of the app is probably running).\n`
      + 'Stop it with Ctrl+C in its terminal, or use another port: PORT=5174 npm run dev');
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`Astronaut Health Monitor: http://localhost:${port}`);
});
