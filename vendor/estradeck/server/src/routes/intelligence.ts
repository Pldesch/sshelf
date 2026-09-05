import { Router } from 'express';
import { asyncHandler } from '../errors';
import { generateSlideHtml, completePrompt } from '../decks/intelligence';

export const intelligenceRouter = Router({ mergeParams: true });

// POST /api/decks/:id/si — generate a slide-HTML chunk from a natural-language prompt.
intelligenceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body ?? {};
    const html = await generateSlideHtml(id, {
      code: String(body.code ?? ''),
      selection: body.selection ? String(body.selection) : undefined,
      prompt: String(body.prompt ?? ''),
      mode: body.mode === 'replace' ? 'replace' : body.mode === 'section' ? 'section' : 'compose',
    });
    res.json({ html });
  }),
);

// POST /api/decks/:id/si/complete — ghost-text autocomplete for the SI prompt itself.
intelligenceRouter.post(
  '/complete',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body ?? {};
    const completion = await completePrompt(id, {
      prompt: String(body.prompt ?? ''),
      mode: body.mode === 'replace' ? 'replace' : 'compose',
      code: body.code ? String(body.code) : undefined,
    });
    res.json({ completion });
  }),
);
