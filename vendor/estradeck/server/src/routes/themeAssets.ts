import express, { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { MAX_IMAGE_BYTES, extForContentType } from '../decks/images';
import {
  listThemeAssets,
  saveThemeImage,
  addThemeImageFromUrl,
  downloadThemeVideo,
  deleteThemeAsset,
} from '../themes/assets';

export const themeAssetsRouter = Router({ mergeParams: true });

themeAssetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    res.json({ assets: listThemeAssets(id) });
  }),
);

// Raw binary image upload (drag-and-drop / file picker).
themeAssetsRouter.post(
  '/',
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, 'No image data received', 'EMPTY_IMAGE');
    }
    const name = typeof req.query.name === 'string' ? req.query.name : req.get('x-filename') ?? '';
    const ext = extForContentType(req.get('content-type')) ?? '.png';
    res.status(201).json(saveThemeImage(id, name, body, ext));
  }),
);

// Download an image from a URL into the theme's assets.
themeAssetsRouter.post(
  '/from-url',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    res.status(201).json(await addThemeImageFromUrl(id, url));
  }),
);

// Download a video (YouTube et al.) into the theme's assets via yt-dlp.
themeAssetsRouter.post(
  '/video-from-url',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    res.status(201).json(await downloadThemeVideo(id, url));
  }),
);

themeAssetsRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const { id, name } = req.params as { id: string; name: string };
    deleteThemeAsset(id, name);
    res.status(204).end();
  }),
);
