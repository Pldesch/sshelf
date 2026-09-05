import fs from 'node:fs';
import {
  generateFromContext,
  completePromptCore,
  type SiContext,
  type SiRequest,
  type SiCompleteRequest,
} from '../decks/intelligence';
import { HttpError } from '../errors';
import { themeExists, themeCssPath } from './paths';
import { listThemeAssets } from './assets';

function themeContext(themeId: string): SiContext {
  let styles = '';
  try {
    styles = fs.readFileSync(themeCssPath(themeId), 'utf8');
    if (styles.length > 6000) styles = styles.slice(0, 6000) + '\n/* …truncated… */';
  } catch {
    /* no theme.css */
  }
  const assets = listThemeAssets(themeId);
  return {
    styles,
    images: assets.filter((a) => a.kind === 'image').map((a) => a.ref),
    videos: assets
      .filter((a) => a.kind === 'video')
      .map((a) => ({ ref: a.ref, poster: a.posterUrl ? `assets/${a.posterUrl.split('/').pop()}` : undefined })),
    slides: [],
    isTheme: true,
  };
}

export async function generateThemeSlideHtml(themeId: string, req: SiRequest): Promise<string> {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  return generateFromContext(themeContext(themeId), req);
}

export async function completeThemePrompt(themeId: string, req: SiCompleteRequest): Promise<string> {
  if (!themeExists(themeId)) return '';
  return completePromptCore(req);
}
