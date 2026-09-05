import safeParse from 'postcss-safe-parser';
import type { ThemeVar } from '@studio/shared';
import { THEME_BLOCK_START, THEME_BLOCK_END } from '@studio/shared';
import { hashContent } from '../deck/io';
import { firstDeckRoot } from '../deck/css';

// The theme palette/fonts are materialized into each deck's styles.css as a
// sentinel-delimited "managed block": a comment carrying the theme id + a content
// hash, followed by a :root rule. It sits ABOVE the deck's own :root so deck
// overrides win by cascade, and BELOW any leading @import so the import stays valid.
// "Sync from theme" re-splices only this block; everything else stays byte-identical.

const SENTINEL_START = THEME_BLOCK_START;
const SENTINEL_END = THEME_BLOCK_END;

/** Stable hash of a theme's variables — stamped into the managed-block sentinel so a
 *  deck can tell whether it's in sync with the current theme. */
export function hashThemeVars(vars: ThemeVar[]): string {
  const canonical = vars.map((v) => `${v.name}:${v.value.trim()}`).join(';');
  return hashContent(canonical).slice(0, 12);
}

/** Parse the deck's own `:root` variables out of a CSS string (skips the managed block). */
export function rootVars(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const rule = firstDeckRoot(safeParse(css));
  if (rule) {
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) map.set(d.prop, d.value.trim());
    });
  }
  return map;
}

/** Parse the MANAGED block's `:root` variables (the theme layer), if present. */
export function managedRootVars(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = safeParse(css);
  let inManaged = false;
  let target: import('postcss').Rule | null = null;
  root.each((node) => {
    if (target) return;
    if (node.type === 'comment') {
      if (node.text.includes(SENTINEL_START)) inManaged = true;
      else if (node.text.includes(SENTINEL_END)) inManaged = false;
      return;
    }
    if (inManaged && node.type === 'rule' && node.selector === ':root') target = node;
  });
  if (target) {
    (target as import('postcss').Rule).walkDecls((d) => {
      if (d.prop.startsWith('--')) map.set(d.prop, d.value.trim());
    });
  }
  return map;
}

/** A deck's EFFECTIVE `:root` vars: the theme's managed block overlaid by the deck's
 *  own overrides (deck wins). Use this to seed a theme from an already-themed deck. */
export function effectiveRootVars(css: string): Map<string, string> {
  const map = new Map(managedRootVars(css));
  for (const [k, v] of rootVars(css)) map.set(k, v); // deck overrides win
  return map;
}

/** Read the theme id + hash a deck's CSS declares it's bound to, if any. */
export function readDeckThemeRef(css: string): { themeId: string; hash: string } | null {
  const re = new RegExp(SENTINEL_START + '\\s+([a-z0-9-]+)\\s+hash:([0-9a-f]+)', 'i');
  const m = css.match(re);
  return m ? { themeId: m[1], hash: m[2] } : null;
}

/** Build the managed block text (comment + :root) for a theme's variables. */
export function buildManagedBlock(themeId: string, vars: ThemeVar[]): string {
  const hash = hashThemeVars(vars);
  const decls = vars.map((v) => `  ${v.name}: ${v.value.trim()};`).join('\n');
  return (
    `/* ${SENTINEL_START} ${themeId} hash:${hash} — managed by Estradeck. ` +
    `Edit via the theme, not here. */\n` +
    `:root {\n${decls}\n}\n` +
    `/* ${SENTINEL_END} */`
  );
}

/** Remove an existing managed block (and its surrounding blank lines) from CSS. */
export function stripManagedBlock(css: string): string {
  const s = css.indexOf(`/* ${SENTINEL_START}`);
  if (s < 0) return css;
  const endMark = `${SENTINEL_END} */`;
  const e = css.indexOf(endMark, s);
  if (e < 0) return css;
  let start = s;
  let end = e + endMark.length;
  // Swallow a blank line left on either side so we don't accumulate whitespace.
  while (start > 0 && css[start - 1] !== '\n') start--;
  while (end < css.length && css[end] !== '\n') end++;
  if (end < css.length) end++; // consume the trailing newline
  return (css.slice(0, start) + css.slice(end)).replace(/\n{3,}/g, '\n\n');
}

/** Index of the char just past a CSS statement's terminating `;` (depth/quote-aware,
 *  so a `;` inside `url('…wght@300;400…')` is not mistaken for the end). */
function endOfStatement(css: string, from: number): number {
  let quote = '';
  let depth = 0;
  for (let i = from; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === quote && css[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) return i + 1;
  }
  return css.length;
}

/** Index just past the leading run of @charset / @import statements (and any comments
 *  among them) — the managed block goes here so it never precedes an @import. */
function afterLeadingAtRules(css: string): number {
  let i = 0;
  let lastEnd = 0;
  const n = css.length;
  for (;;) {
    while (i < n && /\s/.test(css[i])) i++;
    if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (/^@(import|charset)\b/i.test(css.slice(i, i + 10))) {
      i = endOfStatement(css, i);
      lastEnd = i;
      continue;
    }
    break;
  }
  return lastEnd;
}

/** Character range of the first top-level `:root { … }` block (brace-matched). */
function locateRootBlock(css: string): { start: number; end: number } | null {
  const sel = css.indexOf(':root');
  if (sel < 0) return null;
  const open = css.indexOf('{', sel);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return { start: sel, end: i + 1 };
    }
  }
  return null;
}

/**
 * Apply a theme's variables to a deck's CSS:
 *  1. drop any prior managed block,
 *  2. rebuild the deck's own `:root` to keep only the vars that should win over the
 *     managed block (its genuine overrides + deck-local vars like layout), so the
 *     theme palette isn't shadowed,
 *  3. insert a fresh managed block after the leading @import.
 * Pure string→string; the caller writes the result.
 */
export function applyThemeToCss(css: string, themeId: string, themeVars: ThemeVar[]): string {
  // First time this deck gets a theme? Its :root is still the scaffold, which ships
  // the full default-theme palette (see base-styles.css / themes/default). Those are
  // template defaults, not deliberate choices — so the theme should own every var it
  // governs. On a re-apply/sync the :root already holds only genuine overrides (the
  // prior apply stripped the scaffold defaults), so we keep the ones that truly differ.
  const firstApply = !readDeckThemeRef(css);
  const base = stripManagedBlock(css);
  const themeMap = new Map(themeVars.map((v) => [v.name, v.value.trim().toLowerCase()]));

  // Survivors of the deck's own :root: drop vars the theme now provides.
  let withoutDeckRoot = base;
  const deckRoot = firstDeckRoot(safeParse(base));
  if (deckRoot) {
    const survivors: string[] = [];
    deckRoot.walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      if (themeMap.has(d.prop)) {
        if (firstApply) return; // theme owns it; scaffold default is not an override
        if (themeMap.get(d.prop) === d.value.trim().toLowerCase()) return; // matches theme
      }
      survivors.push(`  ${d.prop}: ${d.value.trim()};`);
    });
    const newRoot = survivors.length ? `:root {\n${survivors.join('\n')}\n}` : '';
    const range = locateRootBlock(base);
    if (range) {
      withoutDeckRoot = base.slice(0, range.start) + newRoot + base.slice(range.end);
    }
  }

  const block = buildManagedBlock(themeId, themeVars);
  const at = afterLeadingAtRules(withoutDeckRoot);
  const before = withoutDeckRoot.slice(0, at).replace(/\s*$/, '\n');
  const after = withoutDeckRoot.slice(at).replace(/^\s*/, '');
  return `${before}\n${block}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
}

/** Deck `:root` vars that differ from the theme (the deck's genuine overrides). */
export function computeOverrides(css: string, themeVars: ThemeVar[]): ThemeVar[] {
  const deckMap = rootVars(stripManagedBlock(css));
  const out: ThemeVar[] = [];
  for (const tv of themeVars) {
    const dv = deckMap.get(tv.name);
    if (dv != null && dv.trim().toLowerCase() !== tv.value.trim().toLowerCase()) {
      out.push({ name: tv.name, value: dv });
    }
  }
  return out;
}
