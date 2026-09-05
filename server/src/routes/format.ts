import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { formatSlideHtml } from '../decks/format';

export const formatRouter = Router({ mergeParams: true });

// POST /api/decks/:id/format — pretty-print a chunk of slide HTML.
formatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const html = String(req.body?.html ?? '');
    if (!html.trim()) throw new HttpError(400, 'No HTML to format', 'NO_HTML');
    res.json({ html: await formatSlideHtml(html) });
  }),
);
