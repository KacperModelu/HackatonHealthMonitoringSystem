// Entry point: API under /api, React app from Vite (dev) or dist/ (production).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from './api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const production = process.env.NODE_ENV === 'production';

const db = openDb();
const app = express();
app.use('/api', createApi(db));

if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Astronaut Health Monitor: http://localhost:${port}`);
});
