import fs from 'node:fs';
import safeParse from 'postcss-safe-parser';
import type { Root, Rule, Comment, ChildNode } from 'postcss';
import type { CssVar, CssVarKind } from '@studio/shared';
import { THEME_BLOCK_START, THEME_BLOCK_END } from '@studio/shared';
import { stylesPath } from '../decks/paths';
import { atomicWrite, hashContent } from './io';
import { HttpError } from '../errors';

const LABELS: Record<string, string> = {
  '--primary-color': 'Primary · purple',
  '--secondary-color': 'Secondary · pink',
  '--accent-purple': 'Accent purple',
  '--ink': 'Ink',
  '--background-color': 'Slide background',
  '--section-divider-bg': 'Section divider bg',
  '--text-color': 'Text',
  '--muted-color': 'Muted text',
  '--line-color': 'Lines',
  '--heading-font': 'Heading font',
  '--body-font': 'Body font',
  '--mono-font': 'Mono font',
  '--base-font-size': 'Base font size',
  '--text-size': 'Body text size',
  '--h1-size': 'H1 size',
  '--h2-size': 'H2 size',
  '--h3-size': 'H3 size',
  '--footnote-size': 'Footnote size',
  '--slide-padding': 'Slide padding',
  '--slide-padding-top': 'Slide padding top',
  '--content-gap': 'Content gap',
  '--box-radius': 'Box radius',
};

// Brand colors first, then typography/layout — the rest follow file order.
const ORDER = [
  '--primary-color',
  '--secondary-color',
  '--accent-purple',
  '--ink',
  '--background-color',
  '--section-divider-bg',
  '--text-color',
  '--muted-color',
  '--line-color',
  '--heading-font',
  '--body-font',
  '--mono-font',
  '--base-font-size',
  '--text-size',
  '--h1-size',
  '--h2-size',
  '--h3-size',
  '--footnote-size',
  '--slide-padding',
  '--slide-padding-top',
  '--content-gap',
  '--box-radius',
];

function kindOf(name: string, value: string): CssVarKind {
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^(rgba?|hsla?)\(/i.test(v)) return 'color';
  if (name.includes('font') && !/^-?[\d.]/.test(v)) return 'font';
  if (/^-?[\d.]+(px|pt|em|rem|%|vh|vw)$/.test(v)) return 'length';
  return 'other';
}

function toVar(name: string, value: string): CssVar {
  return {
    name,
    value,
    kind: kindOf(name, value),
    label: LABELS[name] ?? name.replace(/^--/, '').replace(/-/g, ' '),
  };
}

/**
 * The deck's OWN `:root` rule — i.e. the first `:root` that is not the theme's
 * managed block. Themed decks carry a managed `:root` (between the @studio-theme
 * sentinel comments) ahead of the deck's own; the Colors panel must read/write the
 * deck's own so its edits become per-deck overrides, never edits to the managed block.
 */
export function firstDeckRoot(root: Root): Rule | null {
  let inManaged = false;
  let found: Rule | null = null;
  root.each((node: ChildNode) => {
    if (found) return;
    if (node.type === 'comment') {
      const text = (node as Comment).text;
      if (text.includes(THEME_BLOCK_START)) inManaged = true;
      else if (text.includes(THEME_BLOCK_END)) inManaged = false;
      return;
    }
    if (!inManaged && node.type === 'rule' && (node as Rule).selector === ':root') {
      found = node as Rule;
    }
  });
  return found;
}

function firstRootRule(css: string): { root: Root; rule: Rule | null } {
  const root = safeParse(css);
  return { root, rule: firstDeckRoot(root) };
}

export function readVars(deckId: string): CssVar[] {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) return [];
  const { rule } = firstRootRule(fs.readFileSync(file, 'utf8'));
  if (!rule) return [];
  const map = new Map<string, string>();
  (rule as Rule).walkDecls((d) => {
    if (d.prop.startsWith('--')) map.set(d.prop, d.value.trim());
  });
  const seen = new Set<string>();
  const out: CssVar[] = [];
  for (const name of ORDER) {
    if (map.has(name)) {
      out.push(toVar(name, map.get(name)!));
      seen.add(name);
    }
  }
  for (const [name, value] of map) {
    if (!seen.has(name)) out.push(toVar(name, value));
  }
  return out;
}

/** Read the deck's full styles.css verbatim, with a content hash for optimistic saves. */
export function readRawCss(deckId: string): { css: string; contentHash: string } {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'styles.css not found', 'NO_STYLES');
  const css = fs.readFileSync(file, 'utf8');
  return { css, contentHash: hashContent(css) };
}

/**
 * Overwrite styles.css with new contents. `expectedHash` enables last-writer
 * detection (409) the same way slide edits do; CSS edits are intentionally NOT
 * snapshotted to history, which tracks only the HTML deck file.
 */
export function writeRawCss(deckId: string, css: string, expectedHash?: string): string {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'styles.css not found', 'NO_STYLES');
  const current = fs.readFileSync(file, 'utf8');
  if (expectedHash && hashContent(current) !== expectedHash) {
    throw new HttpError(409, 'styles.css changed on disk — reload to get the latest', 'CONFLICT');
  }
  atomicWrite(file, css);
  return hashContent(css);
}

export function writeVars(deckId: string, changes: { name: string; value: string }[]): void {
  const file = stylesPath(deckId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'styles.css not found', 'NO_STYLES');
  for (const c of changes) {
    if (typeof c?.name !== 'string' || typeof c?.value !== 'string') {
      throw new HttpError(400, 'Each change needs a name and value', 'INVALID_CHANGE');
    }
    if (!/^--[\w-]+$/.test(c.name)) throw new HttpError(400, `Invalid variable ${c.name}`, 'INVALID_CHANGE');
    if (/[{};]/.test(c.value)) throw new HttpError(400, 'Value may not contain { } or ;', 'INVALID_VALUE');
  }

  const { root, rule } = firstRootRule(fs.readFileSync(file, 'utf8'));
  if (!rule) throw new HttpError(422, 'No :root rule in styles.css', 'NO_ROOT');
  const byName = new Map(changes.map((c) => [c.name, c.value.trim()]));
  (rule as Rule).walkDecls((d) => {
    if (byName.has(d.prop)) {
      d.value = byName.get(d.prop)!;
      byName.delete(d.prop);
    }
  });
  for (const [name, value] of byName) {
    (rule as Rule).append({ prop: name, value });
  }
  atomicWrite(file, root.toString());
}
