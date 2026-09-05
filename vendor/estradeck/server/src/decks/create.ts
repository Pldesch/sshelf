import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CREATE_PRESENTATION_SCRIPT, REPO_ROOT, DECK_HTML_FILE } from '../config';
import { deckDir, uniqueDeckId } from './paths';

const execFileP = promisify(execFile);

export interface CreateDeckOptions {
  title: string;
}

/** Scaffold a new deck — a single title slide — by shelling out to the skill's
 *  create-presentation.js. Slides are added afterwards from within the studio. */
export async function createDeck(opts: CreateDeckOptions): Promise<string> {
  const title = (opts.title || 'Untitled').trim().slice(0, 120);
  const id = uniqueDeckId(title);
  const html = path.join(deckDir(id), DECK_HTML_FILE);
  await execFileP(
    process.execPath,
    [CREATE_PRESENTATION_SCRIPT, '--structure', '1', '--title', title, '--output', html],
    { cwd: REPO_ROOT },
  );
  return id;
}
