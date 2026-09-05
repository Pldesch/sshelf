import fs from 'node:fs';
import path from 'node:path';
import type { ThemeSlideTemplate, ThemePlaceholder } from '@studio/shared';
import { loadDeck, addSlide } from '../deck/splice';
import { findSlideByKey } from '../deck/parse';
import { deckDir } from '../decks/paths';
import { VIDEO_EXTS } from '../decks/videos';
import { HttpError } from '../errors';
import { themeExists, themeSlidesDir, themeAssetsDir } from './paths';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function slugPaths(themeId: string, slug: string): { html: string; json: string } {
  if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Invalid slide slug', 'INVALID_SLUG');
  const dir = themeSlidesDir(themeId);
  return { html: path.join(dir, `${slug}.html`), json: path.join(dir, `${slug}.json`) };
}

function humanize(key: string): string {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All distinct `{{token}}` keys referenced in a template, in first-seen order. */
export function extractTokens(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/** Ensure every `{{token}}` in the HTML has a manifest entry; keep given metadata,
 *  append sensible defaults for any token not yet described. */
function reconcilePlaceholders(html: string, given: ThemePlaceholder[]): ThemePlaceholder[] {
  const byKey = new Map(given.map((p) => [p.key, p]));
  const out: ThemePlaceholder[] = [];
  const used = new Set<string>();
  // Preserve author-provided order first (only those that are real tokens).
  const tokens = extractTokens(html);
  const tokenSet = new Set(tokens);
  for (const p of given) {
    if (tokenSet.has(p.key) && !used.has(p.key)) {
      out.push(p);
      used.add(p.key);
    }
  }
  // Append any tokens that lack a manifest entry.
  for (const key of tokens) {
    if (!used.has(key)) {
      const prev = byKey.get(key);
      out.push(prev ?? { key, label: humanize(key), default: '', type: 'text' });
      used.add(key);
    }
  }
  return out;
}

export function readSlideTemplate(themeId: string, slug: string): ThemeSlideTemplate {
  const { html: htmlPath, json: jsonPath } = slugPaths(themeId, slug);
  if (!fs.existsSync(htmlPath)) throw new HttpError(404, 'Theme slide not found', 'SLIDE_NOT_FOUND');
  const html = fs.readFileSync(htmlPath, 'utf8');
  let name = slug;
  let placeholders: ThemePlaceholder[] = [];
  if (fs.existsSync(jsonPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
        name?: string;
        placeholders?: ThemePlaceholder[];
      };
      name = j.name ?? slug;
      placeholders = Array.isArray(j.placeholders) ? j.placeholders : [];
    } catch {
      /* fall back to token-derived placeholders */
    }
  }
  placeholders = reconcilePlaceholders(html, placeholders);
  return { slug, name, html, placeholders };
}

export interface WriteSlideInput {
  name?: string;
  html: string;
  placeholders?: ThemePlaceholder[];
}

export function writeSlideTemplate(themeId: string, slug: string, input: WriteSlideInput): ThemeSlideTemplate {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  if (typeof input.html !== 'string' || !/<section[\s>]/i.test(input.html)) {
    throw new HttpError(400, 'Template must contain a <section>', 'INVALID_TEMPLATE');
  }
  const { html: htmlPath, json: jsonPath } = slugPaths(themeId, slug);
  fs.mkdirSync(themeSlidesDir(themeId), { recursive: true });
  const placeholders = reconcilePlaceholders(input.html, input.placeholders ?? []);
  fs.writeFileSync(htmlPath, input.html, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ slug, name: input.name ?? slug, placeholders }, null, 2) + '\n',
    'utf8',
  );
  return { slug, name: input.name ?? slug, html: input.html, placeholders };
}

export function deleteSlideTemplate(themeId: string, slug: string): void {
  const { html: htmlPath, json: jsonPath } = slugPaths(themeId, slug);
  if (!fs.existsSync(htmlPath)) throw new HttpError(404, 'Theme slide not found', 'SLIDE_NOT_FOUND');
  fs.rmSync(htmlPath, { force: true });
  fs.rmSync(jsonPath, { force: true });
}

// --- Rendering -------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** Substitute `{{key}}` tokens with their (HTML-escaped) values; multiline fields turn
 *  newlines into <br>. Unknown tokens fall back to the placeholder default. */
export function renderTemplate(
  html: string,
  values: Record<string, string>,
  placeholders: ThemePlaceholder[],
): string {
  const byKey = new Map(placeholders.map((p) => [p.key, p]));
  return html.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key: string) => {
    const ph = byKey.get(key);
    const raw = values[key] ?? ph?.default ?? '';
    let v = escapeHtml(raw);
    if (ph?.type === 'multiline') v = v.replace(/\n/g, '<br />');
    return v;
  });
}

// --- Asset copying ---------------------------------------------------------

function sameContent(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
  } catch {
    return false;
  }
}

function uniqueName(dir: string, base: string, ext: string): string {
  for (let n = 1; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

/** Copy `images/…`,`videos/…` a deck slide uses into a theme's assets/, rewriting the
 *  references to `assets/NAME`. Returns the rewritten HTML. */
function copyDeckAssetsToTheme(html: string, deckId: string, themeId: string, copied: string[]): string {
  const srcDir = deckDir(deckId);
  const dstDir = themeAssetsDir(themeId);
  const refs = new Set<string>([...html.matchAll(/(?:images|videos)\/[^"'?#)\s>]+/g)].map((m) => m[0]));
  for (const rel of refs) {
    if (rel.includes('..')) continue;
    const srcFile = path.join(srcDir, rel);
    if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
    fs.mkdirSync(dstDir, { recursive: true });
    const ext = path.posix.extname(rel);
    const base = path.posix.basename(rel, ext);
    let name = `${base}${ext}`;
    let dstFile = path.join(dstDir, name);
    if (fs.existsSync(dstFile) && !sameContent(srcFile, dstFile)) {
      name = uniqueName(dstDir, base, ext);
      dstFile = path.join(dstDir, name);
    }
    if (!fs.existsSync(dstFile)) {
      fs.copyFileSync(srcFile, dstFile);
      copied.push(`assets/${name}`);
    }
    html = html.split(rel).join(`assets/${name}`);
  }
  return html;
}

/** Copy `assets/…` a theme slide uses into the deck — videos into `videos/`, images into
 *  `images/` — rewriting references accordingly. Only copies when not already present
 *  (identical file is reused). Returns the rewritten HTML. */
function copyThemeAssetsToDeck(html: string, themeId: string, deckId: string, copied: string[]): string {
  const srcDir = themeAssetsDir(themeId);
  const refs = new Set<string>([...html.matchAll(/assets\/[^"'?#)\s>]+/g)].map((m) => m[0]));
  for (const rel of refs) {
    if (rel.includes('..')) continue;
    const name = path.posix.basename(rel);
    const srcFile = path.join(srcDir, name);
    if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
    const ext = path.posix.extname(name);
    const folder = VIDEO_EXTS.has(ext.toLowerCase()) ? 'videos' : 'images';
    const dstDir = path.join(deckDir(deckId), folder);
    fs.mkdirSync(dstDir, { recursive: true });
    const base = path.posix.basename(name, ext);
    let outName = name;
    let dstFile = path.join(dstDir, outName);
    if (fs.existsSync(dstFile) && !sameContent(srcFile, dstFile)) {
      outName = uniqueName(dstDir, base, ext);
      dstFile = path.join(dstDir, outName);
    }
    if (!fs.existsSync(dstFile)) {
      fs.copyFileSync(srcFile, dstFile);
      copied.push(`${folder}/${outName}`);
    }
    html = html.split(rel).join(`${folder}/${outName}`);
  }
  return html;
}

// --- Section open-tag helpers (whitespace-anchored; mirror deck/splice) ----

function setOpenTagAttr(openTag: string, attr: string, value: string): string {
  const re = new RegExp(`\\s${attr}\\s*=\\s*["'][^"']*["']`, 'i');
  const next = ` ${attr}="${value}"`;
  if (re.test(openTag)) return openTag.replace(re, next);
  return openTag.replace(/<section\b/i, `<section${next}`);
}

// --- Create a theme slide from a deck slide --------------------------------

/** Make a new theme slide template from an existing deck slide. Copies the images/videos
 *  it uses into the theme's assets/. No placeholders yet — the author adds them after. */
export function createSlideFromDeck(
  themeId: string,
  deckId: string,
  slideKey: string,
  name?: string,
): { slug: string; copiedAssets: string[] } {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const slide = findSlideByKey(loadDeck(deckId).model, slideKey);
  if (!slide) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');

  const copiedAssets: string[] = [];
  const html = copyDeckAssetsToTheme(slide.rawHtml, deckId, themeId, copiedAssets);

  const baseSlug = (name ?? slide.id ?? 'slide')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'slide';
  let slug = baseSlug;
  const dir = themeSlidesDir(themeId);
  for (let n = 2; fs.existsSync(path.join(dir, `${slug}.html`)); n++) slug = `${baseSlug}-${n}`;

  writeSlideTemplate(themeId, slug, { name: name ?? slide.title ?? slide.id ?? slug, html });
  return { slug, copiedAssets };
}

// --- Insert a theme slide into a deck --------------------------------------

export function insertThemeSlideIntoDeck(
  deckId: string,
  themeId: string,
  slug: string,
  values: Record<string, string>,
  afterKey: string | null,
): { contentHash: string; newKey: string; copiedAssets: string[] } {
  const tpl = readSlideTemplate(themeId, slug);
  let html = renderTemplate(tpl.html, values, tpl.placeholders);

  const copiedAssets: string[] = [];
  html = copyThemeAssetsToDeck(html, themeId, deckId, copiedAssets);

  // Fresh, non-colliding id in the target deck.
  const used = new Set([...loadDeck(deckId).raw.matchAll(/\bid\s*=\s*"([^"]*)"/g)].map((m) => m[1]));
  const openMatch = html.match(/^<section\b[^>]*>/i);
  const openTag = openMatch ? openMatch[0] : '<section>';
  const baseId = (openTag.match(/\sid\s*=\s*["']([^"']*)["']/i)?.[1] || slug || 'slide');
  let newId = baseId;
  for (let n = 2; used.has(newId); n++) newId = `${baseId}-${n}`;

  let newOpen = setOpenTagAttr(openTag, 'id', newId);
  newOpen = setOpenTagAttr(newOpen, 'data-theme-slide', slug);
  // Provenance: re-editable placeholder values (kept out of the rendered markup).
  const valuesComment = `\n  <!-- studio:theme-values ${JSON.stringify(values)} -->`;
  html = newOpen + valuesComment + html.slice(openTag.length);

  const contentHash = addSlide(deckId, html, afterKey, undefined, `Inserted theme slide ${slug}`);
  return { contentHash, newKey: newId, copiedAssets };
}
