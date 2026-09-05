import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/src -> repo root is two levels up. */
export const REPO_ROOT = path.resolve(here, '..', '..');

// Load secrets (e.g. OPENAI_API_KEY for Slides Intelligence) from a gitignored
// .env at the repo root, before any env-derived config below is read.
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  /* no .env file — rely on the ambient environment */
}
export const PRESENTATIONS_DIR = path.resolve(
  process.env.ESTRADECK_PRESENTATIONS_DIR ?? path.join(tmpdir(), 'sshelf-estradeck-presentations'),
);
export const THEMES_DIR = path.resolve(
  process.env.ESTRADECK_THEMES_DIR ?? path.join(REPO_ROOT, 'themes'),
);
export const SKILL_DIR = path.join(REPO_ROOT, '.claude', 'skills', 'revealjs');
export const SKILLS_ROOT = path.join(REPO_ROOT, '.claude', 'skills');
export const CREATE_PRESENTATION_SCRIPT = path.join(SKILL_DIR, 'scripts', 'create-presentation.js');

export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
export const PORT = Number(process.env.PORT ?? 5174);
export const HOST = process.env.ESTRADECK_HOST ?? '127.0.0.1';
export const PUBLIC_BASE_PATH = (process.env.ESTRADECK_PUBLIC_BASE_PATH ?? '/estradeck').replace(/\/$/, '');

export const DECK_HTML_FILE = 'presentation.html';
export const DECK_STYLES_FILE = 'styles.css';

export const THEME_JSON_FILE = 'theme.json';
export const THEME_CSS_FILE = 'theme.css';
