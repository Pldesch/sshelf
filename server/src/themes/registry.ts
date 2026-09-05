import fs from 'node:fs';
import type { Theme, ThemeSummary, ThemeVar, ThemeSlideSummary, ThemePlaceholder } from '@studio/shared';
import { THEME_VAR_NAMES } from '@studio/shared';
import { atomicWrite } from '../deck/io';
import { stylesPath, slugify } from '../decks/paths';
import { HttpError } from '../errors';
import {
  themeDir,
  themeJsonPath,
  themeCssPath,
  themeSlidesDir,
  themeExists,
  listThemeIds,
} from './paths';
import { rootVars, effectiveRootVars } from './css';

export interface ThemeMeta {
  id: string;
  name: string;
  description: string;
  fontImport: string | null;
  createdAt: number;
  updatedAt: number;
}

function uniqueThemeId(name: string): string {
  const base = slugify(name);
  let id = base;
  for (let n = 2; themeExists(id) || fs.existsSync(themeDir(id)); n++) id = `${base}-${n}`;
  return id;
}

/** Pull the leading `@import url(...)` (web font) line out of a stylesheet, if present. */
export function extractFontImport(css: string): string | null {
  const m = css.match(/@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)\s*;/i);
  return m ? m[1].trim() : null;
}

export function readThemeMeta(id: string): ThemeMeta {
  const raw = fs.readFileSync(themeJsonPath(id), 'utf8');
  const j = JSON.parse(raw) as Partial<ThemeMeta>;
  return {
    id,
    name: j.name ?? id,
    description: j.description ?? '',
    fontImport: j.fontImport ?? null,
    createdAt: j.createdAt ?? 0,
    updatedAt: j.updatedAt ?? 0,
  };
}

export function writeThemeMeta(id: string, meta: ThemeMeta): void {
  atomicWrite(themeJsonPath(id), JSON.stringify(meta, null, 2) + '\n');
}

/** The theme's palette + font variables, in THEME_VAR_NAMES order. */
export function readThemeVars(id: string): ThemeVar[] {
  const file = themeCssPath(id);
  if (!fs.existsSync(file)) return [];
  const map = rootVars(fs.readFileSync(file, 'utf8'));
  const out: ThemeVar[] = [];
  for (const name of THEME_VAR_NAMES) {
    const v = map.get(name);
    if (v != null) out.push({ name, value: v });
  }
  return out;
}

function serializeThemeCss(meta: ThemeMeta, vars: ThemeVar[]): string {
  const decls = vars.map((v) => `  ${v.name}: ${v.value.trim()};`).join('\n');
  const importLine = meta.fontImport ? `@import url('${meta.fontImport}');\n\n` : '';
  return (
    `/* Theme: ${meta.name} — managed by Estradeck.\n` +
    ` * Palette + fonts. Decks using this theme inherit these via a managed :root\n` +
    ` * block in their styles.css; deck-level :root values override them.\n` +
    ` */\n\n` +
    importLine +
    `:root {\n${decls}\n}\n`
  );
}

export function writeThemeVars(id: string, vars: ThemeVar[], ts: number): void {
  const meta = readThemeMeta(id);
  meta.updatedAt = ts;
  atomicWrite(themeCssPath(id), serializeThemeCss(meta, vars));
  writeThemeMeta(id, meta);
}

// --- Standard slide templates (Phase 2 surfaces these; reads are safe now) ---

export function listThemeSlides(id: string): ThemeSlideSummary[] {
  const dir = themeSlidesDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) as {
          slug?: string;
          name?: string;
          placeholders?: ThemePlaceholder[];
        };
        const slug = j.slug ?? f.replace(/\.json$/, '');
        return { slug, name: j.name ?? slug, placeholderCount: (j.placeholders ?? []).length };
      } catch {
        return null;
      }
    })
    .filter((s): s is ThemeSlideSummary => s != null);
}

export function readTheme(id: string): Theme {
  if (!themeExists(id)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const meta = readThemeMeta(id);
  return {
    id,
    name: meta.name,
    description: meta.description,
    fontImport: meta.fontImport,
    vars: readThemeVars(id),
    slides: listThemeSlides(id),
    updatedAt: meta.updatedAt,
  };
}

export function listThemes(): ThemeSummary[] {
  return listThemeIds()
    .map((id) => {
      try {
        const meta = readThemeMeta(id);
        return {
          id,
          name: meta.name,
          description: meta.description,
          varCount: readThemeVars(id).length,
          slideCount: listThemeSlides(id).length,
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is ThemeSummary => s != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CreateThemeOptions {
  name: string;
  description?: string;
  /** Seed palette/fonts from this deck's styles.css. */
  fromDeck?: string;
  ts: number;
}

/** Create a new theme, optionally seeding its palette + fonts from an existing deck. */
export function createTheme(opts: CreateThemeOptions): string {
  const name = (opts.name || 'Untitled theme').trim().slice(0, 80);
  const id = uniqueThemeId(name);
  fs.mkdirSync(themeDir(id), { recursive: true });
  fs.mkdirSync(themeSlidesDir(id), { recursive: true });

  let vars: ThemeVar[] = [];
  let fontImport: string | null = null;
  if (opts.fromDeck) {
    const file = stylesPath(opts.fromDeck);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Source deck has no styles.css', 'NO_STYLES');
    const css = fs.readFileSync(file, 'utf8');
    // Use the EFFECTIVE palette (theme managed block + deck overrides) so seeding from
    // an already-themed deck still captures the full palette, not just its overrides.
    const map = effectiveRootVars(css);
    vars = THEME_VAR_NAMES.flatMap((n) => {
      const v = map.get(n);
      return v != null ? [{ name: n, value: v }] : [];
    });
    fontImport = extractFontImport(css);
  }

  const meta: ThemeMeta = {
    id,
    name,
    description: (opts.description ?? '').slice(0, 280),
    fontImport,
    createdAt: opts.ts,
    updatedAt: opts.ts,
  };
  atomicWrite(themeCssPath(id), serializeThemeCss(meta, vars));
  writeThemeMeta(id, meta);
  return id;
}

/** Delete a theme. Decks that referenced it keep working (their palette is already
 *  materialized) — they just show as "missing" until re-linked. */
export function deleteTheme(id: string): void {
  if (!themeExists(id)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  fs.rmSync(themeDir(id), { recursive: true, force: true });
}

export interface ThemePatch {
  name?: string;
  description?: string;
  fontImport?: string | null;
  vars?: ThemeVar[];
}

function validateVars(vars: ThemeVar[]): void {
  for (const v of vars) {
    if (typeof v?.name !== 'string' || typeof v?.value !== 'string') {
      throw new HttpError(400, 'Each var needs a name and value', 'INVALID_VAR');
    }
    if (!/^--[\w-]+$/.test(v.name)) throw new HttpError(400, `Invalid variable ${v.name}`, 'INVALID_VAR');
    if (/[{};]/.test(v.value)) throw new HttpError(400, 'Value may not contain { } or ;', 'INVALID_VALUE');
  }
}

/** Update a theme's metadata and/or its palette/font variables. */
export function updateTheme(id: string, patch: ThemePatch, ts: number): Theme {
  if (!themeExists(id)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const meta = readThemeMeta(id);
  if (patch.name != null) meta.name = patch.name.trim().slice(0, 80) || meta.name;
  if (patch.description != null) meta.description = patch.description.slice(0, 280);
  if (patch.fontImport !== undefined) meta.fontImport = patch.fontImport;
  meta.updatedAt = ts;
  let vars = readThemeVars(id);
  if (patch.vars != null) {
    validateVars(patch.vars);
    // Keep only themeable vars, in canonical order.
    const incoming = new Map(patch.vars.map((v) => [v.name, v.value.trim()]));
    vars = THEME_VAR_NAMES.flatMap((n) => (incoming.has(n) ? [{ name: n, value: incoming.get(n)! }] : []));
  }
  atomicWrite(themeCssPath(id), serializeThemeCss(meta, vars));
  writeThemeMeta(id, meta);
  return readTheme(id);
}
