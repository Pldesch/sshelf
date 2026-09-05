import express, { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import {
  listImages,
  saveImage,
  deleteImage,
  extForContentType,
  MAX_IMAGE_BYTES,
} from '../decks/images';
import { normalizeUrl } from '../url';

export const imagesRouter = Router({ mergeParams: true });

imagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    res.json({ images: listImages(id) });
  }),
);

// Raw binary upload (drag-and-drop / file picker). The client sends the file bytes
// as the request body with the file's MIME type; the name comes from ?name=.
imagesRouter.post(
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
    res.status(201).json(saveImage(id, name, body, ext));
  }),
);

// Download an image from a URL into the deck's images folder.
imagesRouter.post(
  '/from-url',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const url = normalizeUrl(req.body?.url);
    if (!/^https?:\/\//i.test(url)) {
      throw new HttpError(400, 'Provide an image URL', 'INVALID_URL');
    }
    const resp = await fetch(url, { redirect: 'follow' }).catch((e) => {
      throw new HttpError(400, `Could not fetch URL: ${(e as Error).message}`, 'FETCH_FAILED');
    });
    if (!resp.ok) throw new HttpError(400, `Fetch failed: HTTP ${resp.status}`, 'FETCH_FAILED');
    const ext = extForContentType(resp.headers.get('content-type'));
    if (!ext) {
      const ct = resp.headers.get('content-type') ?? 'unknown';
      throw new HttpError(400, `That URL is not an image (content-type: ${ct})`, 'NOT_AN_IMAGE');
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    let name = '';
    try {
      name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    } catch {
      /* fall back below */
    }
    res.status(201).json(saveImage(id, name || 'download', buf, ext));
  }),
);

imagesRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const { id, name } = req.params as { id: string; name: string };
    deleteImage(id, name);
    res.status(204).end();
  }),
);
