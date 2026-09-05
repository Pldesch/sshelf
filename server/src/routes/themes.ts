import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { listThemes, readTheme, createTheme, updateTheme, deleteTheme } from '../themes/registry';
import { syncDecksUsingTheme } from '../themes/apply';
import {
  readSlideTemplate,
  writeSlideTemplate,
  deleteSlideTemplate,
  createSlideFromDeck,
} from '../themes/slides';
import { buildSlidePreviewPage } from '../themes/preview';
import { generateThemeSlideHtml, completeThemePrompt } from '../themes/intelligence';
import { deckExists } from '../decks/paths';

export const themesRouter = Router();

themesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(listThemes());
  }),
);

themesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, fromDeck } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'name required', 'INVALID_NAME');
    }
    const id = createTheme({
      name,
      description: typeof description === 'string' ? description : undefined,
      fromDeck: typeof fromDeck === 'string' ? fromDeck : undefined,
      ts: Date.now(),
    });
    res.status(201).json({ id });
  }),
);

themesRouter.get(
  '/:themeId',
  asyncHandler(async (req, res) => {
    res.json(readTheme((req.params as { themeId: string }).themeId));
  }),
);

themesRouter.patch(
  '/:themeId',
  asyncHandler(async (req, res) => {
    const { themeId } = req.params as { themeId: string };
    const { name, description, fontImport, vars } = req.body ?? {};
    res.json(
      updateTheme(
        themeId,
        {
          name,
          description,
          fontImport,
          vars: Array.isArray(vars) ? vars : undefined,
        },
        Date.now(),
      ),
    );
  }),
);

themesRouter.delete(
  '/:themeId',
  asyncHandler(async (req, res) => {
    deleteTheme((req.params as { themeId: string }).themeId);
    res.status(204).end();
  }),
);

// Re-apply this theme to every deck currently bound to it.
themesRouter.post(
  '/:themeId/sync-decks',
  asyncHandler(async (req, res) => {
    res.json(syncDecksUsingTheme((req.params as { themeId: string }).themeId));
  }),
);

// --- Theme standard slides (templates with {{placeholders}}) ---
themesRouter.get(
  '/:themeId/slides/:slug',
  asyncHandler(async (req, res) => {
    const { themeId, slug } = req.params as { themeId: string; slug: string };
    res.json(readSlideTemplate(themeId, slug));
  }),
);

themesRouter.put(
  '/:themeId/slides/:slug',
  asyncHandler(async (req, res) => {
    const { themeId, slug } = req.params as { themeId: string; slug: string };
    const { name, html, placeholders } = req.body ?? {};
    if (typeof html !== 'string') throw new HttpError(400, 'html required', 'INVALID_TEMPLATE');
    res.json(
      writeSlideTemplate(themeId, slug, {
        name: typeof name === 'string' ? name : undefined,
        html,
        placeholders: Array.isArray(placeholders) ? placeholders : undefined,
      }),
    );
  }),
);

themesRouter.delete(
  '/:themeId/slides/:slug',
  asyncHandler(async (req, res) => {
    const { themeId, slug } = req.params as { themeId: string; slug: string };
    deleteSlideTemplate(themeId, slug);
    res.status(204).end();
  }),
);

// Create a theme slide from an existing deck slide (then the author adds placeholders).
themesRouter.post(
  '/:themeId/slides/from-deck',
  asyncHandler(async (req, res) => {
    const { themeId } = req.params as { themeId: string };
    const { deckId, slideKey, name } = req.body ?? {};
    if (typeof deckId !== 'string' || !deckExists(deckId)) {
      throw new HttpError(400, 'A valid deckId is required', 'INVALID_DECK');
    }
    if (typeof slideKey !== 'string' || !slideKey) {
      throw new HttpError(400, 'slideKey is required', 'INVALID_SLIDE');
    }
    res.status(201).json(
      createSlideFromDeck(themeId, deckId, slideKey, typeof name === 'string' ? name : undefined),
    );
  }),
);

// Slides Intelligence for theme templates (⌘K): generate / prompt-autocomplete.
themesRouter.post(
  '/:themeId/si',
  asyncHandler(async (req, res) => {
    const { themeId } = req.params as { themeId: string };
    const body = req.body ?? {};
    const html = await generateThemeSlideHtml(themeId, {
      code: String(body.code ?? ''),
      selection: body.selection ? String(body.selection) : undefined,
      prompt: String(body.prompt ?? ''),
      mode: body.mode === 'replace' ? 'replace' : 'compose',
    });
    res.json({ html });
  }),
);

themesRouter.post(
  '/:themeId/si/complete',
  asyncHandler(async (req, res) => {
    const { themeId } = req.params as { themeId: string };
    const body = req.body ?? {};
    const completion = await completeThemePrompt(themeId, {
      prompt: String(body.prompt ?? ''),
      mode: body.mode === 'replace' ? 'replace' : 'compose',
      code: body.code ? String(body.code) : undefined,
    });
    res.json({ completion });
  }),
);

// Live-preview page for the insert dialog / theme slide editor (values via ?values=JSON).
themesRouter.get(
  '/:themeId/slides/:slug/preview',
  asyncHandler(async (req, res) => {
    const { themeId, slug } = req.params as { themeId: string; slug: string };
    let values: Record<string, string> = {};
    if (typeof req.query.values === 'string') {
      try {
        const parsed = JSON.parse(req.query.values);
        if (parsed && typeof parsed === 'object') values = parsed as Record<string, string>;
      } catch {
        /* ignore malformed values — preview with defaults */
      }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildSlidePreviewPage(themeId, slug, values));
  }),
);
