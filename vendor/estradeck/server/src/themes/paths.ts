import fs from 'node:fs';
import path from 'node:path';
import { THEMES_DIR, THEME_JSON_FILE, THEME_CSS_FILE } from '../config';
import { HttpError } from '../errors';

/** Resolve a theme's directory, rejecting any id that escapes THEMES_DIR. */
export function themeDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new HttpError(400, 'Invalid theme id', 'INVALID_THEME_ID');
  }
  const dir = path.resolve(THEMES_DIR, id);
  if (path.dirname(dir) !== THEMES_DIR) {
    throw new HttpError(400, 'Invalid theme id', 'INVALID_THEME_ID');
  }
  return dir;
}

export function themeJsonPath(id: string): string {
  return path.join(themeDir(id), THEME_JSON_FILE);
}

export function themeCssPath(id: string): string {
  return path.join(themeDir(id), THEME_CSS_FILE);
}

export function themeSlidesDir(id: string): string {
  return path.join(themeDir(id), 'slides');
}

export function themeAssetsDir(id: string): string {
  return path.join(themeDir(id), 'assets');
}

export function themeExists(id: string): boolean {
  try {
    return fs.existsSync(themeJsonPath(id));
  } catch {
    return false;
  }
}

export function listThemeIds(): string[] {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs
    .readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(THEMES_DIR, d.name, THEME_JSON_FILE)))
    .map((d) => d.name);
}
