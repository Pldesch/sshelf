import fs from 'node:fs';
import path from 'node:path';
import { loadDeck, addSlide } from '../deck/splice';
import { findSlideByKey } from '../deck/parse';
import { deckDir } from './paths';
import { HttpError } from '../errors';

/** Set/replace the `id` on a `<section>` open tag (whitespace-anchored so it never
 *  matches a substring or another attribute like `data-id`). Mirrors splice.ts. */
function setSectionId(openTag: string, id: string): string {
  const attr = `id="${id}"`;
  if (/\sid\s*=\s*["'][^"']*["']/i.test(openTag)) {
    return openTag.replace(/\sid\s*=\s*["'][^"']*["']/i, ` ${attr}`);
  }
  return openTag.replace(/<section\b/i, `<section ${attr}`);
}

function sameContent(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
  } catch {
    return false;
  }
}

/** Pick `images/foo-1.png`, `images/foo-2.png`, … that doesn't yet exist in `dstDir`. */
function uniqueRel(dstDir: string, rel: string): string {
  const dir = path.posix.dirname(rel);
  const ext = path.posix.extname(rel);
  const base = path.posix.basename(rel, ext);
  for (let n = 1; ; n++) {
    const candidate = `${dir}/${base}-${n}${ext}`;
    if (!fs.existsSync(path.join(dstDir, candidate))) return candidate;
  }
}

/**
 * Copy every `images/…` and `videos/…` file the slide references from the source deck
 * into the target deck, and return the (possibly rewritten) HTML. Behaviour per ref:
 *  - target missing the file        → copy it, keep the path
 *  - target has an identical file    → reuse it (no copy, no rewrite)
 *  - target has a *different* file   → copy under a fresh name and rewrite the references
 * Broken refs (missing source file) are left untouched.
 */
function copyAssets(html: string, srcId: string, dstId: string, copied: string[]): string {
  const srcDir = deckDir(srcId);
  const dstDir = deckDir(dstId);
  const refs = new Set<string>([...html.matchAll(/(?:images|videos)\/[^"'?#)\s>]+/g)].map((m) => m[0]));
  for (const rel of refs) {
    if (rel.includes('..')) continue; // never follow a path-traversal reference
    const srcFile = path.join(srcDir, rel);
    if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
    let destRel = rel;
    let dstFile = path.join(dstDir, rel);
    if (fs.existsSync(dstFile)) {
      if (sameContent(srcFile, dstFile)) continue; // already present and identical
      destRel = uniqueRel(dstDir, rel);
      dstFile = path.join(dstDir, destRel);
    }
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    copied.push(destRel);
    if (destRel !== rel) html = html.split(rel).join(destRel);
  }
  return html;
}

/**
 * Copy one slide from `sourceDeckId` into `targetDeckId` (appended at the end, or after
 * `afterKey`). The slide's `<section>` gets a fresh id that doesn't collide in the target,
 * and any images/videos it uses are copied across (with conflict-safe renaming). Styles are
 * NOT merged — decks share the brand design system, so common classes carry over, but a
 * one-off class defined only in the source deck's styles.css won't follow the slide.
 */
export function copySlideToDeck(
  sourceDeckId: string,
  sourceKey: string,
  targetDeckId: string,
  afterKey: string | null = null,
): { contentHash: string; newKey: string; copiedAssets: string[] } {
  const slide = findSlideByKey(loadDeck(sourceDeckId).model, sourceKey);
  if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');

  let html = slide.rawHtml;

  // Give the copy a non-colliding id in the target deck.
  const used = new Set(
    [...loadDeck(targetDeckId).raw.matchAll(/\bid\s*=\s*"([^"]*)"/g)].map((m) => m[1]),
  );
  const baseId = slide.id || 'slide';
  let newId = baseId;
  for (let n = 2; used.has(newId); n++) newId = `${baseId}-${n}`;
  const openLen = slide.openTagEnd - slide.startOffset;
  html = setSectionId(html.slice(0, openLen), newId) + html.slice(openLen);

  // Bring along any images/videos the slide references.
  const copiedAssets: string[] = [];
  html = copyAssets(html, sourceDeckId, targetDeckId, copiedAssets);

  const contentHash = addSlide(
    targetDeckId,
    html,
    afterKey,
    undefined,
    `Copied slide ${baseId} from ${sourceDeckId}`,
  );
  return { contentHash, newKey: newId, copiedAssets };
}
