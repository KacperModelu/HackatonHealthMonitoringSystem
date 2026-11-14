// Entry point: API under /api, React app from Vite (dev) or dist/ (production).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from './api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const production = process.env.NODE_ENV === 'production';

const db = openDb();
const app = express();
const server = http.createServer(app);
app.use('/api', createApi(db));

if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
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
