import fs from 'node:fs';
import path from 'node:path';
import type { ImageInfo } from '@studio/shared';
import { deckDir, deckExists } from './paths';
import { HttpError } from '../errors';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
]);

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export function imagesDir(id: string): string {
  return path.join(deckDir(id), 'images');
}

function requireDeck(id: string): void {
  if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
}

/** Map an HTTP content-type to a file extension, or null if it isn't an image type. */
export function extForContentType(ct: string | undefined | null): string | null {
  if (!ct) return null;
  return CONTENT_TYPE_EXT[ct.split(';')[0].trim().toLowerCase()] ?? null;
}

/** A filesystem-safe image filename with an allowed image extension. */
export function safeImageName(rawName: string, fallbackExt = '.png'): string {
  const base = path.basename(rawName || '').trim();
  let ext = path.extname(base).toLowerCase();
  let stem = ext ? base.slice(0, -ext.length) : base;
  stem = stem
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  if (!stem) stem = 'image';
  if (!IMAGE_EXTS.has(ext)) ext = fallbackExt;
  return `${stem}${ext}`;
}

function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) candidate = `${stem}-${n++}${ext}`;
  return candidate;
}

function infoFor(id: string, name: string): ImageInfo {
  const st = fs.statSync(path.join(imagesDir(id), name));
  const enc = encodeURIComponent(name);
  return {
    name,
    url: `/decks/${id}/images/${enc}`,
    ref: `images/${name}`,
    size: st.size,
    mtime: st.mtimeMs,
  };
}

export function listImages(id: string): ImageInfo[] {
  requireDeck(id);
  const dir = imagesDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXTS.has(path.extname(d.name).toLowerCase()))
    .map((d) => infoFor(id, d.name))
    .sort((a, b) => b.mtime - a.mtime);
}

/** Validate + atomically write image bytes into `dir` under a unique safe name; returns
 *  the stored filename. Shared by deck images and theme assets. */
export function saveImageToDir(dir: string, rawName: string, data: Buffer, fallbackExt = '.png'): string {
  if (data.length === 0) throw new HttpError(400, 'Empty image', 'EMPTY_IMAGE');
  if (data.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'Image too large (max 25 MB)', 'IMAGE_TOO_LARGE');
  }
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, safeImageName(rawName, fallbackExt));
  const dest = path.join(dir, name);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
  return name;
}

export function saveImage(
  id: string,
  rawName: string,
  data: Buffer,
  fallbackExt = '.png',
): ImageInfo {
  requireDeck(id);
  return infoFor(id, saveImageToDir(imagesDir(id), rawName, data, fallbackExt));
}

export function deleteImage(id: string, rawName: string): void {
  requireDeck(id);
  const name = path.basename(rawName || '');
  const file = path.join(imagesDir(id), name);
  if (
    !name ||
    !IMAGE_EXTS.has(path.extname(name).toLowerCase()) ||
    path.dirname(file) !== imagesDir(id)
  ) {
    throw new HttpError(400, 'Invalid image name', 'INVALID_IMAGE');
  }
  if (!fs.existsSync(file)) throw new HttpError(404, 'Image not found', 'IMAGE_NOT_FOUND');
  fs.rmSync(file);
}
