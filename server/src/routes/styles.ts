import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { deckExists } from '../decks/paths';
import { readVars, writeVars, readRawCss, writeRawCss } from '../deck/css';

export const stylesRouter = Router({ mergeParams: true });

stylesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(readVars(id));
  }),
);

// --- Raw styles.css (the full stylesheet, edited in the Styles tab) ---
stylesRouter.get(
  '/raw',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(readRawCss(id));
  }),
);

stylesRouter.put(
  '/raw',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const css = req.body?.css;
    if (typeof css !== 'string') throw new HttpError(400, 'css required', 'INVALID_CSS');
    const expectedHash =
      typeof req.body?.expectedHash === 'string' ? req.body.expectedHash : undefined;
    res.json({ contentHash: writeRawCss(id, css, expectedHash) });
  }),
);

stylesRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    writeVars(id, changes);
    res.json({ ok: true });
  }),
);
