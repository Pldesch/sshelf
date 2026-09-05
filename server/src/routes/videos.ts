import { Router } from 'express';
import { asyncHandler, HttpError } from '../errors';
import { listVideos, deleteVideo, downloadVideo } from '../decks/videos';

export const videosRouter = Router({ mergeParams: true });

videosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    res.json({ videos: listVideos(id) });
  }),
);

// Download a video from a URL (YouTube et al.) into the deck's videos/ folder.
videosRouter.post(
  '/from-url',
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) throw new HttpError(400, 'Provide a video URL', 'INVALID_URL');
    res.status(201).json(await downloadVideo(id, url));
  }),
);

videosRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const { id, name } = req.params as { id: string; name: string };
    deleteVideo(id, name);
    res.status(204).end();
  }),
);
