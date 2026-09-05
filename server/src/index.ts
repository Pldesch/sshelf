import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { PORT, PRESENTATIONS_DIR, THEMES_DIR } from './config';
import { createWsHub } from './ws';
import { startWatcher } from './watcher';
import { decksRouter } from './routes/decks';
import { slidesRouter } from './routes/slides';
import { stylesRouter } from './routes/styles';
import { imagesRouter } from './routes/images';
import { videosRouter } from './routes/videos';
import { historyRouter } from './routes/history';
import { intelligenceRouter } from './routes/intelligence';
import { formatRouter } from './routes/format';
import { createAgentRouter } from './routes/agent';
import { themesRouter } from './routes/themes';
import { themeAssetsRouter } from './routes/themeAssets';
import { deckThemeRouter } from './routes/deckTheme';
import { jobManager } from './agent/jobs';
import { asyncHandler, errorHandler, HttpError } from './errors';
import { formatSlideHtml } from './decks/format';
import { baseStyles } from './themes/preview';
import { scrapeImages } from './scrape';

fs.mkdirSync(PRESENTATIONS_DIR, { recursive: true });
fs.mkdirSync(THEMES_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '8mb' }));

const server = http.createServer(app);
const hub = createWsHub(server, {
  onSubscribe: (deckId) => [{ type: 'jobs-snapshot', deckId, jobs: jobManager.list(deckId) }],
});
startWatcher(hub);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Generic (deck-agnostic) HTML pretty-print — used by the theme slide editor's Format.
app.post(
  '/api/format',
  asyncHandler(async (req, res) => {
    const html = String(req.body?.html ?? '');
    if (!html.trim()) throw new HttpError(400, 'No HTML to format', 'NO_HTML');
    res.json({ html: await formatSlideHtml(html) });
  }),
);

// List the images referenced on a web page (for the command-palette image picker).
app.post(
  '/api/scrape-images',
  asyncHandler(async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    res.json({ images: await scrapeImages(url) });
  }),
);

// The brand base component styles, so the theme editor can offer class autocompletion.
app.get('/api/brand/base.css', (_req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(baseStyles());
});

app.use('/api/themes/:id/assets', themeAssetsRouter);
app.use('/api/themes', themesRouter);
app.use('/api/decks/:id/agent', createAgentRouter(hub));
app.use('/api/decks/:id/theme', deckThemeRouter);
app.use('/api/decks/:id/styles', stylesRouter);
app.use('/api/decks/:id/images', imagesRouter);
app.use('/api/decks/:id/videos', videosRouter);
app.use('/api/decks/:id/history', historyRouter);
app.use('/api/decks/:id/si', intelligenceRouter);
app.use('/api/decks/:id/format', formatRouter);
app.use('/api/decks/:id/slides', slidesRouter);
app.use('/api/decks', decksRouter);

// Static serving of theme files (theme.css + assets/) for the slide preview harness.
app.use(
  '/themes',
  express.static(THEMES_DIR, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.css') || filePath.endsWith('.html') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }),
);

// Static serving of deck files for the preview iframe.
// no-store so the iframe always reloads the freshest HTML/CSS after an edit.
app.use(
  '/decks',
  express.static(PRESENTATIONS_DIR, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }),
);

app.use(errorHandler);

server.listen(PORT, () => console.log(`[studio] server listening on http://localhost:${PORT}`));
