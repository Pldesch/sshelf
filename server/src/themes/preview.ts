import fs from 'node:fs';
import path from 'node:path';
import { SKILL_DIR } from '../config';
import { themeExists } from './paths';
import { HttpError } from '../errors';
import { readSlideTemplate, renderTemplate } from './slides';

const REVEAL = 'https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist';
const FONT_AWESOME = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';

let baseStylesCache: string | null = null;
export function baseStyles(): string {
  if (baseStylesCache == null) {
    try {
      baseStylesCache = fs.readFileSync(path.join(SKILL_DIR, 'references', 'base-styles.css'), 'utf8');
    } catch {
      baseStylesCache = '';
    }
  }
  return baseStylesCache;
}

/**
 * A standalone reveal.js page rendering a single theme slide, for the live preview iframe.
 * Loads (in cascade order) reveal core CSS → the brand base components (inlined from the
 * skill) → the theme's own palette/fonts (theme.css). `<base>` points at the theme dir so
 * `assets/…` references resolve.
 */
export function buildSlidePreviewPage(
  themeId: string,
  slug: string,
  values: Record<string, string>,
): string {
  if (!themeExists(themeId)) throw new HttpError(404, 'Theme not found', 'THEME_NOT_FOUND');
  const tpl = readSlideTemplate(themeId, slug);
  const section = renderTemplate(tpl.html, values, tpl.placeholders);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="/themes/${themeId}/" />
  <link rel="stylesheet" href="${REVEAL}/reset.css" />
  <link rel="stylesheet" href="${REVEAL}/reveal.css" />
  <link rel="stylesheet" href="${FONT_AWESOME}" />
  <style>
${baseStyles()}
  </style>
  <link rel="stylesheet" href="theme.css" />
  <style>
    html, body { margin: 0; height: 100%; background: #0f0f17; }
    .reveal, .reveal .slides { height: 100vh; }
    .reveal .slides section { display: flex; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${section}
    </div>
  </div>
  <script src="${REVEAL}/reveal.js"></script>
  <script>
    // keyboard:false — the parent (theme preview) is the single controller and forwards
    // arrow keys via Reveal.next()/prev(), so stepping never double-fires.
    Reveal.initialize({ embedded: false, controls: false, progress: false, hash: false, transition: 'none', center: false, keyboard: false });
    // Reveal this slide's fragments on load so the sample content shows; the parent can
    // then step backward/forward (arrow keys) to test the entry animations.
    Reveal.on('ready', () => {
      let guard = 0;
      while (Reveal.nextFragment() && guard++ < 300) { /* reveal all fragments */ }
    });
  </script>
</body>
</html>
`;
}
