import fs from 'node:fs';
import path from 'node:path';
import { PRESENTATIONS_DIR, DECK_HTML_FILE, DECK_STYLES_FILE } from '../config';
import { HttpError } from '../errors';

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'deck';
}

/** Resolve a deck's directory, rejecting any id that escapes PRESENTATIONS_DIR. */
export function deckDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new HttpError(400, 'Invalid deck id', 'INVALID_DECK_ID');
  }
  const dir = path.resolve(PRESENTATIONS_DIR, id);
  if (path.dirname(dir) !== PRESENTATIONS_DIR) {
    throw new HttpError(400, 'Invalid deck id', 'INVALID_DECK_ID');
  }
  return dir;
}

export function htmlPath(id: string): string {
  return path.join(deckDir(id), DECK_HTML_FILE);
}

export function stylesPath(id: string): string {
  return path.join(deckDir(id), DECK_STYLES_FILE);
}

export function deckExists(id: string): boolean {
  try {
    return fs.existsSync(htmlPath(id));
  } catch {
    return false;
  }
}

export function uniqueDeckId(title: string): string {
  const base = slugify(title);
  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(PRESENTATIONS_DIR, id))) {
    id = `${base}-${n++}`;
  }
  return id;
}

export function listDeckIds(): string[] {
  if (!fs.existsSync(PRESENTATIONS_DIR)) return [];
  return fs
    .readdirSync(PRESENTATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PRESENTATIONS_DIR, d.name, DECK_HTML_FILE)))
    .map((d) => d.name);
}
