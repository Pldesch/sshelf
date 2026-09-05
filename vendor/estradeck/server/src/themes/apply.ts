import fs from 'node:fs';
import type { DeckThemeState } from '@studio/shared';
import { atomicWrite } from '../deck/io';
import { stylesPath, listDeckIds } from '../decks/paths';
import { HttpError } from '../errors';
import { themeExists } from './paths';
import { readThemeVars, readThemeMeta } from './registry';
import {
  applyThemeToCss,
  readDeckThemeRef,
  hashThemeVars,
  computeOverrides,
} from './css';

const EMPTY: DeckThemeState = {
  themeId: null,
  themeName: null,
  inSync: false,
  missing: false,
  overrides: [],
};

/** Derive a deck's relationship to its theme from its styles.css. */
export function deckThemeState(deckId: string): DeckThemeState {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) return { ...EMPTY };
  const css = fs.readFileSync(file, 'utf8');
  const ref = readDeckThemeRef(css);
  if (!ref) return { ...EMPTY };
  if (!themeExists(ref.themeId)) {
    return { ...EMPTY, themeId: ref.themeId, missing: true };
  }
  const themeVars = readThemeVars(ref.themeId);
  return {
    themeId: ref.themeId,
    themeName: readThemeMeta(ref.themeId).name,
    inSync: ref.hash === hashThemeVars(themeVars),
    missing: false,
    overrides: computeOverrides(css, themeVars),
  };
}

/** Associate a deck with a theme: materialize its palette/fonts into styles.css. */
export function setDeckTheme(deckId: string, themeId: string): DeckThemeState {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'styles.css not found', 'NO_STYLES');
  const css = fs.readFileSync(file, 'utf8');
  atomicWrite(file, applyThemeToCss(css, themeId, readThemeVars(themeId)));
  return deckThemeState(deckId);
}

/** Re-apply the deck's current theme (after the theme's palette/fonts changed). */
export function syncDeckTheme(deckId: string): DeckThemeState {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'styles.css not found', 'NO_STYLES');
  const ref = readDeckThemeRef(fs.readFileSync(file, 'utf8'));
  if (!ref) throw new HttpError(422, 'Deck is not associated with a theme', 'NO_THEME');
  return setDeckTheme(deckId, ref.themeId);
}

/** Re-apply a theme to every deck currently bound to it. Returns the deck ids synced. */
export function syncDecksUsingTheme(themeId: string): { synced: string[] } {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const synced: string[] = [];
  for (const deckId of listDeckIds()) {
    const file = stylesPath(deckId);
    if (!fs.existsSync(file)) continue;
    const ref = readDeckThemeRef(fs.readFileSync(file, 'utf8'));
    if (ref?.themeId === themeId) {
      setDeckTheme(deckId, themeId);
      synced.push(deckId);
    }
  }
  return { synced };
}
