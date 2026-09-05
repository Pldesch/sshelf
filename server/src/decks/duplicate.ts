import fs from 'node:fs';
import path from 'node:path';
import { DECK_HTML_FILE } from '../config';
import { deckDir, deckExists, uniqueDeckId } from './paths';
import { HttpError } from '../errors';

// Derived/heavy artifacts that shouldn't follow a deck into its working copy.
const EXCLUDE = new Set(['out.pdf', 'screenshots', '.DS_Store', '.git']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Copy a deck — its slides (presentation.html), styles.css, charts.js and assets
 * (images/, videos/) — into a brand-new deck folder so the user can work on a copy.
 * Export artifacts (out.pdf, screenshots/) are intentionally left behind. History is
 * stored outside the deck folder, so the copy starts with a clean history. Returns the
 * new deck id.
 */
export function duplicateDeck(sourceId: string, title?: string): string {
  if (!deckExists(sourceId)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
  const src = deckDir(sourceId);

  const trimmedTitle = (title ?? '').trim();
  const newId = uniqueDeckId(trimmedTitle || `${sourceId} copy`);
  const dest = deckDir(newId); // validates the generated id

  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name) || entry.name.endsWith('.tmp')) continue;
    fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true });
  }

  // Reflect the chosen name in the copy's <title> so it reads correctly in the deck list.
  if (trimmedTitle) {
    const htmlFile = path.join(dest, DECK_HTML_FILE);
    try {
      const html = fs.readFileSync(htmlFile, 'utf8');
      const updated = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(trimmedTitle)}</title>`);
      if (updated !== html) fs.writeFileSync(htmlFile, updated);
    } catch {
      /* title is a nicety — never fail a copy over it */
    }
  }

  return newId;
}
