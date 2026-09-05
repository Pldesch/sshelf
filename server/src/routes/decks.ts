import { Router } from 'express';
import fs from 'node:fs';
import type { DeckSummary } from '@studio/shared';
import { asyncHandler, HttpError } from '../errors';
import { listDeckIds, htmlPath, deckDir, deckExists } from '../decks/paths';
import fsp from 'node:fs/promises';
import { createDeck } from '../decks/create';
import { duplicateDeck } from '../decks/duplicate';
import { readDeckConfig, patchDeckConfig } from '../decks/deckConfig';
import { exportDeckPdf } from '../decks/export';
import { readRaw } from '../deck/io';
import { parseDeck, countSlides } from '../deck/parse';

export const decksRouter = Router();

decksRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const summaries: DeckSummary[] = [];
    for (const id of listDeckIds()) {
      try {
        const file = htmlPath(id);
        const model = parseDeck(id, readRaw(file));
        summaries.push({
          id,
          title: model.title,
          slideCount: countSlides(model),
          mtime: fs.statSync(file).mtimeMs,
        });
      } catch {
        summaries.push({ id, title: id, slideCount: 0, mtime: 0 });
      }
    }
    summaries.sort((a, b) => b.mtime - a.mtime);
    res.json(summaries);
  }),
);

decksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title } = req.body ?? {};
    const id = await createDeck({ title });
    res.status(201).json({ id });
  }),
);

// Copy a deck (slides, styles, images, videos) into a new working folder.
decksRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    res.status(201).json({ id: duplicateDeck(id, title) });
  }),
);

decksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(parseDeck(id, readRaw(htmlPath(id))));
  }),
);

decksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const dir = deckDir(id);
    if (!fs.existsSync(dir)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    fs.rmSync(dir, { recursive: true, force: true });
    res.status(204).end();
  }),
);

// Export the deck to a PDF (headless Chrome via reveal print-pdf) and stream it.
decksRouter.get(
  '/:id/export.pdf',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const file = await exportDeckPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.pdf"`);
    res.sendFile(file, (err) => {
      void fsp.rm(file, { force: true });
      if (err && !res.headersSent) res.status(500).end();
    });
  }),
);

// Deck-wide defaults (the Reveal.initialize transition).
decksRouter.get(
  '/:id/config',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(readDeckConfig(id));
  }),
);

decksRouter.patch(
  '/:id/config',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const { transition, transitionSpeed } = req.body ?? {};
    res.json(patchDeckConfig(id, { transition, transitionSpeed }));
  }),
);
