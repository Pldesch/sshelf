import * as prettier from 'prettier';
import { HttpError } from '../errors';

/**
 * Pretty-print one slide's HTML. Uses Prettier's HTML formatter with CSS-aware
 * whitespace sensitivity, so it indents structure for readability WITHOUT changing
 * how the slide renders (significant whitespace around inline elements is preserved).
 */
export async function formatSlideHtml(html: string): Promise<string> {
  try {
    const out = await prettier.format(html, {
      parser: 'html',
      printWidth: 100,
      tabWidth: 2,
      htmlWhitespaceSensitivity: 'css',
    });
    return out.trim();
  } catch (e) {
    throw new HttpError(400, `Could not format: ${(e as Error).message}`, 'FORMAT_FAILED');
  }
}
