import fs from 'node:fs';
import path from 'node:path';
import type { ThemeAsset } from '@studio/shared';
import { HttpError } from '../errors';
import { themeAssetsDir, themeExists } from './paths';
import {
  IMAGE_EXTS,
  MAX_IMAGE_BYTES,
  extForContentType,
  saveImageToDir,
} from '../decks/images';
import { VIDEO_EXTS, posterNameFor, downloadVideoToDir } from '../decks/videos';
import { normalizeUrl } from '../url';

function requireTheme(id: string): void {
  if (!themeExists(id)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
}

function kindOf(name: string): 'image' | 'video' | null {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return null;
}

function assetInfo(id: string, name: string): ThemeAsset {
  const dir = themeAssetsDir(id);
  const st = fs.statSync(path.join(dir, name));
  const enc = encodeURIComponent(name);
  const kind = kindOf(name) === 'video' ? 'video' : 'image';
  let posterUrl: string | undefined;
  if (kind === 'video') {
    const poster = posterNameFor(name);
    if (fs.existsSync(path.join(dir, poster))) {
      posterUrl = `/themes/${id}/assets/${encodeURIComponent(poster)}`;
    }
  }
  return {
    name,
    kind,
    url: `/themes/${id}/assets/${enc}`,
    ref: `assets/${name}`,
    posterUrl,
    size: st.size,
    mtime: st.mtimeMs,
  };
}

/** List a theme's assets (images + videos). Video poster frames are attached to their
 *  video, not listed as separate images. */
export function listThemeAssets(id: string): ThemeAsset[] {
  requireTheme(id);
  const dir = themeAssetsDir(id);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
  // Stems of video files, so a "<stem>.jpg" poster isn't shown as a standalone image.
  const videoStems = new Set(
    files.filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase())).map((f) => f.slice(0, -path.extname(f).length)),
  );
  return files
    .filter((f) => {
      const kind = kindOf(f);
      if (!kind) return false;
      if (kind === 'image' && path.extname(f).toLowerCase() === '.jpg' && videoStems.has(f.slice(0, -4))) {
        return false; // a video's poster frame
      }
      return true;
    })
    .map((f) => assetInfo(id, f))
    .sort((a, b) => b.mtime - a.mtime);
}

export function saveThemeImage(id: string, rawName: string, data: Buffer, fallbackExt = '.png'): ThemeAsset {
  requireTheme(id);
  return assetInfo(id, saveImageToDir(themeAssetsDir(id), rawName, data, fallbackExt));
}

export async function addThemeImageFromUrl(id: string, rawUrl: string): Promise<ThemeAsset> {
  requireTheme(id);
  const url = normalizeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'Provide an image URL', 'INVALID_URL');
  const resp = await fetch(url, { redirect: 'follow' }).catch((e) => {
    throw new HttpError(400, `Could not fetch URL: ${(e as Error).message}`, 'FETCH_FAILED');
  });
  if (!resp.ok) throw new HttpError(400, `Fetch failed: HTTP ${resp.status}`, 'FETCH_FAILED');
  const ext = extForContentType(resp.headers.get('content-type'));
  if (!ext) {
    const ct = resp.headers.get('content-type') ?? 'unknown';
    throw new HttpError(400, `That URL is not an image (content-type: ${ct})`, 'NOT_AN_IMAGE');
  }
  if (Number(resp.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'Image too large (max 25 MB)', 'IMAGE_TOO_LARGE');
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    /* fall back below */
  }
  return saveThemeImage(id, name || 'download', buf, ext);
}

export async function downloadThemeVideo(id: string, url: string): Promise<ThemeAsset> {
  requireTheme(id);
  if (!url) throw new HttpError(400, 'Provide a video URL', 'INVALID_URL');
  const name = await downloadVideoToDir(themeAssetsDir(id), url);
  return assetInfo(id, name);
}

export function deleteThemeAsset(id: string, rawName: string): void {
  requireTheme(id);
  const dir = themeAssetsDir(id);
  const name = path.basename(rawName || '');
  const file = path.join(dir, name);
  if (!name || !kindOf(name) || path.dirname(file) !== dir) {
    throw new HttpError(400, 'Invalid asset name', 'INVALID_ASSET');
  }
  if (!fs.existsSync(file)) throw new HttpError(404, 'Asset not found', 'ASSET_NOT_FOUND');
  fs.rmSync(file);
  // Remove a video's poster frame too.
  if (kindOf(name) === 'video') {
    const poster = path.join(dir, posterNameFor(name));
    if (fs.existsSync(poster)) fs.rmSync(poster);
  }
}
