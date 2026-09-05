import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PORT, REPO_ROOT } from '../config';
import { deckExists } from './paths';
import { HttpError } from '../errors';

const execFileP = promisify(execFile);
const DECKTAPE = path.join(REPO_ROOT, 'node_modules', 'decktape', 'decktape.js');

/** Locate a Chrome/Chromium binary for headless rendering (decktape + video export use it). */
export function chromeBinary(): string {
  const env = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new HttpError(
    500,
    'No Chrome/Chromium found for PDF export — set the CHROME_BIN env var to its path.',
    'NO_CHROME',
  );
}

/**
 * Render a deck to PDF with decktape, which drives reveal.js slide-by-slide and
 * captures each slide in its normal layout (fragments revealed, charts rendered) —
 * one pixel-perfect page per slide. Uses the system Chrome. Returns the temp path.
 */
export async function exportDeckPdf(deckId: string): Promise<string> {
  if (!deckExists(deckId)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
  if (!fs.existsSync(DECKTAPE)) {
    throw new HttpError(500, 'decktape is not installed (npm i decktape).', 'NO_DECKTAPE');
  }
  const chrome = chromeBinary();
  const out = path.join(os.tmpdir(), `studio-${deckId}-${Date.now()}.pdf`);
  const url = `http://localhost:${PORT}/decks/${encodeURIComponent(deckId)}/presentation.html`;

  const args = [
    DECKTAPE,
    'reveal',
    '--chrome-path', chrome,
    '--size', '1280x720',
    '--pause', '1500', // let each slide's fonts, images and ECharts finish before capture
    url,
    out,
  ];

  try {
    await execFileP(process.execPath, args, { cwd: REPO_ROOT, timeout: 180_000 });
  } catch (e) {
    throw new HttpError(500, `PDF export failed: ${(e as Error).message}`, 'EXPORT_FAILED');
  }
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    throw new HttpError(500, 'PDF export produced no file', 'EXPORT_FAILED');
  }
  return out;
}
