import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { deckExists } from '../decks/paths';
import { listHistory, restoreHistory } from '../decks/history';

export const historyRouter = Router({ mergeParams: true });

function requireDeck(id: string): void {
  if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
}

historyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    requireDeck(id);
    res.json({ snapshots: listHistory(id) });
  }),
);

historyRouter.post(
  '/:snapId/restore',
  asyncHandler(async (req, res) => {
    const { id, snapId } = req.params as { id: string; snapId: string };
    requireDeck(id);
    res.json({ contentHash: restoreHistory(id, snapId) });
  }),
);
