import { Router } from 'express';
import type { JobKind } from '@studio/shared';
import { asyncHandler, HttpError } from '../errors';
import { deckExists } from '../decks/paths';
import { loadDeck, reserveSlides } from '../deck/splice';
import { findSlideByKey } from '../deck/parse';
import { planSlides } from '../decks/intelligence';
import { jobManager } from '../agent/jobs';
import type { WsHub } from '../ws';

let batchCounter = 0;

function requireDeck(id: string): void {
  if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
}

export function createAgentRouter(hub: WsHub): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { id } = req.params as { id: string };
      requireDeck(id);
      res.json(jobManager.list(id));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { id } = req.params as { id: string };
      requireDeck(id);
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) throw new HttpError(400, 'Prompt is required', 'NO_PROMPT');

      const kind: JobKind = req.body?.kind === 'edit' ? 'edit' : 'create';
      let targetKey: string | null = null;
      let targetLabel = 'New slide';

      if (kind === 'edit') {
        targetKey = typeof req.body?.targetKey === 'string' ? req.body.targetKey : null;
        if (!targetKey) throw new HttpError(400, 'targetKey is required for edit jobs', 'NO_TARGET');
        const slide = findSlideByKey(loadDeck(id).model, targetKey);
        if (!slide) throw new HttpError(404, 'Target slide not found', 'SLIDE_NOT_FOUND');
        targetLabel = slide.id ? `#${slide.id}` : slide.title?.slice(0, 24) || 'Slide';
      }

      const job = jobManager.enqueue(id, { kind, targetKey, targetLabel, prompt }, hub);
      res.status(202).json(job);
    }),
  );

  // Generate MULTIPLE coherent slides: plan an ordered outline, reserve placeholders in
  // order, then fan out one fill-agent per placeholder (they run in parallel and each
  // writes only its own reserved slide, so order is preserved and there are no clashes).
  router.post(
    '/batch',
    asyncHandler(async (req, res) => {
      const { id } = req.params as { id: string };
      requireDeck(id);
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      if (!topic) throw new HttpError(400, 'A topic is required', 'NO_TOPIC');
      const count = Math.min(Math.max(1, Math.floor(Number(req.body?.count) || 0)), 12);
      const afterKey = typeof req.body?.afterKey === 'string' ? req.body.afterKey : null;
      if (afterKey && !findSlideByKey(loadDeck(id).model, afterKey)) {
        throw new HttpError(404, 'Target slide not found', 'SLIDE_NOT_FOUND');
      }

      const briefs = await planSlides(id, topic, count);
      const { keys } = reserveSlides(id, briefs.length, afterKey);
      const batchId = `batch-${Date.now()}-${++batchCounter}`;
      const outline = briefs.map((b, i) => `${i + 1}. ${b.title}`).join('\n');

      briefs.forEach((b, i) => {
        const prompt = `${b.brief}\n\nThis is slide ${i + 1} of ${briefs.length} in a coherent sequence about "${topic}". The full outline is:\n${outline}\n\nBuild ONLY slide ${i + 1} ("${b.title}"). Keep it consistent with the others in style and narrative, and do not repeat their content.`;
        jobManager.enqueue(
          id,
          { kind: 'create', targetKey: keys[i], targetLabel: b.title.slice(0, 24) || `Slide ${i + 1}`, prompt, batchId },
          hub,
        );
      });

      res.status(202).json({ batchId, keys, count: briefs.length });
    }),
  );

  router.post(
    '/:jobId/cancel',
    asyncHandler(async (req, res) => {
      const { id, jobId } = req.params as { id: string; jobId: string };
      requireDeck(id);
      jobManager.cancel(id, jobId, hub);
      res.status(204).end();
    }),
  );

  return router;
}
