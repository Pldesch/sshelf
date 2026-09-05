import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { deckExists } from '../decks/paths';
import { deckThemeState, setDeckTheme, syncDeckTheme } from '../themes/apply';
import { insertThemeSlideIntoDeck } from '../themes/slides';

export const deckThemeRouter = Router({ mergeParams: true });

deckThemeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(deckThemeState(id));
  }),
);

deckThemeRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const themeId = req.body?.themeId;
    if (typeof themeId !== 'string' || !themeId) {
      throw new HttpError(400, 'themeId required', 'INVALID_THEME_ID');
    }
    res.json(setDeckTheme(id, themeId));
  }),
);

deckThemeRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    res.json(syncDeckTheme(id));
  }),
);

// Insert a theme standard slide (rendered with placeholder values) into this deck.
deckThemeRouter.post(
  '/insert',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
    const { themeId, slug, values, afterKey } = req.body ?? {};
    if (typeof themeId !== 'string' || !themeId) throw new HttpError(400, 'themeId required', 'INVALID_THEME_ID');
    if (typeof slug !== 'string' || !slug) throw new HttpError(400, 'slug required', 'INVALID_SLUG');
    const vals = values && typeof values === 'object' ? (values as Record<string, string>) : {};
    res.status(201).json(
      insertThemeSlideIntoDeck(id, themeId, slug, vals, typeof afterKey === 'string' ? afterKey : null),
    );
  }),
);
