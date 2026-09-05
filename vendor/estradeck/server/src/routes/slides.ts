import fsp from 'node:fs/promises';
import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { deckExists } from '../decks/paths';
import { loadDeck, putSlide, addSlide, deleteSlide, duplicateSlide, patchSlideOpenTag, reorderSlides } from '../deck/splice';
import { findSlideByKey, isSingleSection } from '../deck/parse';
import { editOpenTag, getFragmentElements, patchFragment } from '../deck/sections';
import { exportSlideVideo } from '../decks/videoExport';
import { copySlideToDeck } from '../decks/copySlide';

export const slidesRouter = Router({ mergeParams: true });

function requireDeck(id: string): void {
  if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
}

slidesRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const { model } = loadDeck(id);
    const slide = findSlideByKey(model, key);
    if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
    res.json({ slide, contentHash: model.contentHash });
  }),
);

slidesRouter.put(
  '/:key',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const { rawHtml, expectedHash } = req.body ?? {};
    if (typeof rawHtml !== 'string') throw new HttpError(400, 'rawHtml required', 'INVALID_SLIDE');
    if (!isSingleSection(rawHtml)) {
      throw new HttpError(400, 'Slide must be exactly one <section> element', 'INVALID_SLIDE');
    }
    const contentHash = putSlide(id, key, rawHtml, expectedHash);
    res.json({ contentHash });
  }),
);

slidesRouter.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    requireDeck(id);
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order || order.some((k: unknown) => typeof k !== 'string')) {
      throw new HttpError(400, 'order must be an array of slide keys', 'INVALID_ORDER');
    }
    const contentHash = reorderSlides(id, order, req.body?.expectedHash);
    res.json({ contentHash });
  }),
);

slidesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    requireDeck(id);
    const { rawHtml, afterKey, expectedHash } = req.body ?? {};
    const html = typeof rawHtml === 'string' && rawHtml.trim()
      ? rawHtml
      : '<section><h2>New Slide</h2></section>';
    if (!isSingleSection(html)) {
      throw new HttpError(400, 'Slide must be exactly one <section> element', 'INVALID_SLIDE');
    }
    const contentHash = addSlide(id, html, afterKey ?? null, expectedHash);
    res.json({ contentHash });
  }),
);

slidesRouter.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const expectedHash = typeof req.query.expectedHash === 'string' ? req.query.expectedHash : undefined;
    const contentHash = deleteSlide(id, key, expectedHash);
    res.json({ contentHash });
  }),
);

slidesRouter.post(
  '/:key/duplicate',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    res.json(duplicateSlide(id, key, req.body?.expectedHash));
  }),
);

// Copy this slide (and the images/videos it uses) into another deck.
slidesRouter.post(
  '/:key/copy-to',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const targetDeckId = typeof req.body?.targetDeckId === 'string' ? req.body.targetDeckId : '';
    if (!targetDeckId) throw new HttpError(400, 'targetDeckId is required', 'INVALID_TARGET');
    if (targetDeckId === id) throw new HttpError(400, 'Pick a different deck', 'SAME_DECK');
    if (!deckExists(targetDeckId)) throw new HttpError(404, 'Target deck not found', 'DECK_NOT_FOUND');
    res.json(copySlideToDeck(id, key, targetDeckId, req.body?.afterKey ?? null));
  }),
);

// --- Section attributes: transition / speed / auto-animate / background / class ---
slidesRouter.patch(
  '/:key/section',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const attrs = (req.body?.attrs ?? {}) as Record<string, string | boolean | null>;
    const expectedHash = req.body?.expectedHash as string | undefined;
    const contentHash = patchSlideOpenTag(id, key, (openTag) => editOpenTag(openTag, attrs), expectedHash);
    res.json({ contentHash });
  }),
);

// --- Fragment elements within a slide ---
slidesRouter.get(
  '/:key/fragments',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    res.json(getFragmentElements(id, key));
  }),
);

slidesRouter.patch(
  '/:key/fragment',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const { elementIndex, fragment, effect, fragmentIndex, expectedHash } = req.body ?? {};
    if (typeof elementIndex !== 'number') {
      throw new HttpError(400, 'elementIndex required', 'INVALID_FRAGMENT');
    }
    const contentHash = patchFragment(
      id,
      key,
      elementIndex,
      Boolean(fragment),
      typeof effect === 'string' ? effect : '',
      typeof fragmentIndex === 'number' ? fragmentIndex : null,
      expectedHash,
    );
    res.json({ contentHash });
  }),
);

// Render this slide (with its fragment animations) to an MP4 and stream it back.
slidesRouter.post(
  '/:key/video',
  asyncHandler(async (req, res) => {
    const { id, key } = req.params as { id: string; key: string };
    requireDeck(id);
    const durations = req.body?.durations as number[];
    const fps = Number(req.body?.fps) || 30;
    const file = await exportSlideVideo(id, key, { durations, fps });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-${key}.mp4"`);
    res.sendFile(file, (err) => {
      void fsp.rm(file, { force: true });
      if (err && !res.headersSent) res.status(500).end();
    });
  }),
);
