import type { DeckModel, Slide } from '@studio/shared';
import { HttpError } from '../errors';
import { readRaw, atomicWrite, hashContent } from './io';
import { htmlPath } from '../decks/paths';
import { recordHistory } from '../decks/history';
import { parseDeck, findSlideByKey } from './parse';

export interface DeckFile {
  raw: string;
  hash: string;
  model: DeckModel;
}

export function loadDeck(deckId: string): DeckFile {
  const raw = readRaw(htmlPath(deckId));
  const model = parseDeck(deckId, raw);
  return { raw, hash: model.contentHash, model };
}

function assertHash(actual: string, expected?: string): void {
  if (expected && expected !== actual) {
    throw new HttpError(409, 'Deck changed on disk — reload to get the latest', 'CONFLICT');
  }
}

/** Replace one slide's full source range with new HTML; returns the new content hash. */
export function putSlide(
  deckId: string,
  key: string,
  newRawHtml: string,
  expectedHash?: string,
): string {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  const slide = findSlideByKey(model, key);
  if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
  return writeSpliced(deckId, raw, slide.startOffset, slide.endOffset, newRawHtml, `Edited ${slide.id || key}`);
}

/**
 * Re-locate a slide by key against the current file and apply a transform to its
 * open tag (start tag) only, leaving the slide's inner HTML byte-identical.
 */
export function patchSlideOpenTag(
  deckId: string,
  key: string,
  transform: (openTag: string, slide: Slide) => string,
  expectedHash?: string,
): string {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  const slide = findSlideByKey(model, key);
  if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
  const openTag = raw.slice(slide.openTagStart, slide.openTagEnd);
  const newOpenTag = transform(openTag, slide);
  return writeSpliced(deckId, raw, slide.openTagStart, slide.openTagEnd, newOpenTag, `Changed ${slide.id || key}`);
}

/**
 * Low-level: splice [start,end) of the deck file with `text` and atomically write.
 * `label` describes the change; the pre-change bytes are snapshotted to history first.
 */
export function writeSpliced(
  deckId: string,
  raw: string,
  start: number,
  end: number,
  text: string,
  label: string,
): string {
  recordHistory(deckId, raw, label);
  const out = raw.slice(0, start) + text + raw.slice(end);
  atomicWrite(htmlPath(deckId), out);
  return hashContent(out);
}

/** Insert a new top-level slide. afterKey null/undefined => append at end of .slides. */
export function addSlide(
  deckId: string,
  rawHtml: string,
  afterKey: string | null,
  expectedHash?: string,
  label = 'Added slide',
): string {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  let insertAt: number;
  if (afterKey) {
    const slide = model.slides.find((s) => s.key === afterKey);
    if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
    insertAt = slide.endOffset;
  } else {
    const last = model.slides[model.slides.length - 1];
    insertAt = last ? last.endOffset : model.slidesInner.startOffset;
  }
  const block = `\n      ${rawHtml.trim()}\n`;
  return writeSpliced(deckId, raw, insertAt, insertAt, block, label);
}

/** Set/replace the `id` attribute on a `<section>` open tag (whitespace-anchored so
 *  it never matches a substring like `valid` or another attribute such as `data-id`). */
function setSectionId(openTag: string, id: string): string {
  const attr = `id="${id}"`;
  if (/\sid\s*=\s*["'][^"']*["']/i.test(openTag)) {
    return openTag.replace(/\sid\s*=\s*["'][^"']*["']/i, ` ${attr}`);
  }
  return openTag.replace(/<section\b/i, `<section ${attr}`);
}

/**
 * Duplicate a top-level slide, inserting the copy right after it with a fresh unique
 * id (so reveal hash navigation and the studio key stay unambiguous).
 */
export function duplicateSlide(
  deckId: string,
  key: string,
  expectedHash?: string,
): { contentHash: string; newKey: string } {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  const slide = model.slides.find((s) => s.key === key);
  if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');

  // Avoid colliding with any id already in the document.
  const usedIds = new Set([...raw.matchAll(/\bid\s*=\s*"([^"]*)"/g)].map((m) => m[1]));
  const base = slide.id || 'slide';
  let newId = `${base}-copy`;
  for (let n = 2; usedIds.has(newId); n++) newId = `${base}-copy-${n}`;

  const openLen = slide.openTagEnd - slide.startOffset;
  const dupHtml = setSectionId(slide.rawHtml.slice(0, openLen), newId) + slide.rawHtml.slice(openLen);

  const contentHash = addSlide(deckId, dupHtml, key, expectedHash, `Duplicated ${base}`);
  return { contentHash, newKey: newId };
}

/**
 * Insert `count` empty placeholder slides (in order) at a position, returning their
 * keys. Used by "generate multiple slides": positions are reserved up front so parallel
 * fill jobs land in the intended order regardless of which agent finishes first.
 */
export function reserveSlides(
  deckId: string,
  count: number,
  afterKey: string | null,
  expectedHash?: string,
): { contentHash: string; keys: string[] } {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  let insertAt: number;
  if (afterKey) {
    const slide = model.slides.find((s) => s.key === afterKey);
    if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
    insertAt = slide.endOffset;
  } else {
    const last = model.slides[model.slides.length - 1];
    insertAt = last ? last.endOffset : model.slidesInner.startOffset;
  }
  const used = new Set([...raw.matchAll(/\bid\s*=\s*"([^"]*)"/g)].map((m) => m[1]));
  const base = `gen-${Date.now().toString(36)}`;
  const keys: string[] = [];
  const indent = '      ';
  const blocks: string[] = [];
  for (let k = 1; k <= count; k++) {
    let id = `${base}-${k}`;
    for (let n = 2; used.has(id); n++) id = `${base}-${k}-${n}`;
    used.add(id);
    keys.push(id);
    blocks.push(`<section id="${id}" data-gen="pending">\n${indent}  <h2>Generating…</h2>\n${indent}</section>`);
  }
  const block = `\n${blocks.map((b) => indent + b).join('\n')}\n`;
  const contentHash = writeSpliced(
    deckId,
    raw,
    insertAt,
    insertAt,
    block,
    `Reserved ${count} slide${count > 1 ? 's' : ''}`,
  );
  return { contentHash, keys };
}

/** Reorder the top-level slides to match `order` (a permutation of their keys). */
export function reorderSlides(deckId: string, order: string[], expectedHash?: string): string {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  const topKeys = model.slides.map((s) => s.key);
  if (order.length !== topKeys.length || topKeys.some((k) => !order.includes(k))) {
    throw new HttpError(400, 'Order must be a permutation of the top-level slide keys', 'INVALID_ORDER');
  }
  const byKey = new Map(model.slides.map((s) => [s.key, s.rawHtml]));
  const indent = '      ';
  const inner = `\n${order.map((k) => indent + byKey.get(k)).join('\n')}\n    `;
  return writeSpliced(deckId, raw, model.slidesInner.startOffset, model.slidesInner.endOffset, inner, 'Reordered slides');
}

/** Delete a top-level slide (and any trailing whitespace up to the next slide). */
export function deleteSlide(deckId: string, key: string, expectedHash?: string): string {
  const { raw, hash, model } = loadDeck(deckId);
  assertHash(hash, expectedHash);
  const idx = model.slides.findIndex((s) => s.key === key);
  if (idx === -1) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
  if (model.slides.length === 1) {
    throw new HttpError(400, 'Cannot delete the only slide', 'LAST_SLIDE');
  }
  const slide = model.slides[idx];
  const next = model.slides[idx + 1];
  // Extend deletion to the start of the next slide (or end of slides region) so we
  // don't leave a dangling blank line.
  const end = next ? next.startOffset : model.slidesInner.endOffset;
  // Trim leading whitespace before the slide back to the previous newline.
  let start = slide.startOffset;
  while (start > 0 && (raw[start - 1] === ' ' || raw[start - 1] === '\t')) start--;
  if (raw[start - 1] === '\n') start--;
  return writeSpliced(deckId, raw, start, end, next ? `\n${' '.repeat(6)}` : '\n    ', `Deleted ${slide.id || key}`);
}
