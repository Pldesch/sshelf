import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { VideoInfo } from '@studio/shared';
import { deckDir, deckExists, stylesPath } from './paths';
import { atomicWrite } from '../deck/io';
import { HttpError } from '../errors';
import { normalizeUrl } from '../url';

export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

/** Cap downloads so a deck folder can't balloon from one paste. */
const MAX_FILESIZE = '300m';
/** yt-dlp can be slow on long videos; give it room but don't hang forever. */
const DOWNLOAD_TIMEOUT_MS = 6 * 60_000;

export function videosDir(id: string): string {
  return path.join(deckDir(id), 'videos');
}

function requireDeck(id: string): void {
  if (!deckExists(id)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
}

// ffmpeg wants `-version` (single dash); yt-dlp wants `--version`.
function hasBin(bin: string, versionArg = '--version'): boolean {
  try {
    const r = spawnSync(bin, [versionArg], { stdio: 'ignore' });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

function safeVideoName(rawName: string, fallbackExt = '.mp4'): string {
  const base = path.basename(rawName || '').trim();
  let ext = path.extname(base).toLowerCase();
  let stem = ext ? base.slice(0, -ext.length) : base;
  stem = stem
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  if (!stem) stem = 'video';
  if (!VIDEO_EXTS.has(ext)) ext = fallbackExt;
  return `${stem}${ext}`;
}

function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) candidate = `${stem}-${n++}${ext}`;
  return candidate;
}

export function posterNameFor(videoName: string): string {
  const ext = path.extname(videoName);
  return `${ext ? videoName.slice(0, -ext.length) : videoName}.jpg`;
}

function infoFor(id: string, name: string): VideoInfo {
  const dir = videosDir(id);
  const st = fs.statSync(path.join(dir, name));
  const posterName = posterNameFor(name);
  const hasPoster = fs.existsSync(path.join(dir, posterName));
  return {
    name,
    url: `/decks/${id}/videos/${encodeURIComponent(name)}`,
    ref: `videos/${name}`,
    poster: hasPoster ? `videos/${posterName}` : undefined,
    posterUrl: hasPoster ? `/decks/${id}/videos/${encodeURIComponent(posterName)}` : undefined,
    size: st.size,
    mtime: st.mtimeMs,
  };
}

export function listVideos(id: string): VideoInfo[] {
  requireDeck(id);
  const dir = videosDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && VIDEO_EXTS.has(path.extname(d.name).toLowerCase()))
    .map((d) => infoFor(id, d.name))
    .sort((a, b) => b.mtime - a.mtime);
}

export function deleteVideo(id: string, rawName: string): void {
  requireDeck(id);
  const name = path.basename(rawName || '');
  const dir = videosDir(id);
  const file = path.join(dir, name);
  if (!name || !VIDEO_EXTS.has(path.extname(name).toLowerCase()) || path.dirname(file) !== dir) {
    throw new HttpError(400, 'Invalid video name', 'INVALID_VIDEO');
  }
  if (!fs.existsSync(file)) throw new HttpError(404, 'Video not found', 'VIDEO_NOT_FOUND');
  fs.rmSync(file);
  const poster = path.join(dir, posterNameFor(name));
  if (fs.existsSync(poster)) fs.rmSync(poster);
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new HttpError(504, 'Video download timed out', 'DOWNLOAD_TIMEOUT'));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new HttpError(500, `${cmd} is not installed`, 'NO_BIN'));
      } else {
        reject(e);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** Last couple of meaningful lines of yt-dlp stderr, for a useful error message. */
function tailLines(s: string, n = 2): string {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-n).join(' — ') || 'unknown error';
}

/** Grab a poster frame ~1s in (best-effort; falls back to frame 0 for short clips). */
function makePoster(dir: string, videoName: string): void {
  if (!hasBin('ffmpeg', '-version')) return;
  const src = path.join(dir, videoName);
  const out = path.join(dir, posterNameFor(videoName));
  const args = (seek: string[]) => [...seek, '-i', src, '-frames:v', '1', '-q:v', '3', '-y', out];
  let r = spawnSync('ffmpeg', args(['-ss', '1']), { stdio: 'ignore' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    r = spawnSync('ffmpeg', args([]), { stdio: 'ignore' });
  }
}

const VIDEO_CSS = `
/* --- Video embeds (added by the studio) --- */
.video-embed {
  position: relative;
  margin: 0 auto;
  max-width: 960px;
  aspect-ratio: 16 / 9;
  border-radius: var(--box-radius, 14px);
  overflow: hidden;
  border: 1px solid var(--line-color, rgba(255, 255, 255, 0.14));
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  background: #000;
}
.video-embed video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-caption {
  margin-top: 0.5em;
  font-size: var(--footnote-size, 0.5em);
  color: var(--muted-color, #9aa0b5);
  text-align: center;
}
`;

/** Add the default .video-embed look to styles.css once, so embeds look right out of
 *  the box. Idempotent and best-effort — the user can then tweak it in the Styles tab. */
function ensureVideoStyles(id: string): void {
  try {
    const file = stylesPath(id);
    if (!fs.existsSync(file)) return;
    const css = fs.readFileSync(file, 'utf8');
    if (/\.video-embed\b/.test(css)) return;
    atomicWrite(file, `${css.trimEnd()}\n${VIDEO_CSS}`);
  } catch {
    /* styling is a nicety; never fail a download over it */
  }
}

/**
 * Download a video (YouTube and anything else yt-dlp supports) into `dir`, capped at
 * 720p, and generate a poster frame next to it. Returns the stored filename. Shared by
 * deck videos and theme assets.
 */
export async function downloadVideoToDir(dir: string, rawUrl: string): Promise<string> {
  const url = normalizeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    throw new HttpError(400, 'Provide a video URL', 'INVALID_URL');
  }
  if (!hasBin('yt-dlp')) {
    throw new HttpError(
      500,
      'yt-dlp is not installed on the server. Install it (e.g. `brew install yt-dlp`) and try again.',
      'NO_YTDLP',
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(dir, '.dl-'));
  try {
    const args = [
      '--no-playlist',
      '--restrict-filenames',
      '-f',
      'bv*[height<=720]+ba/b[height<=720]/b',
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      MAX_FILESIZE,
      '-o',
      path.join(tmp, '%(title).60s.%(ext)s'),
      url,
    ];
    const { code, stderr } = await run('yt-dlp', args, DOWNLOAD_TIMEOUT_MS);
    if (code !== 0) {
      throw new HttpError(400, `Download failed: ${tailLines(stderr)}`, 'DOWNLOAD_FAILED');
    }
    const produced = fs
      .readdirSync(tmp)
      .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()));
    if (produced.length === 0) {
      throw new HttpError(
        400,
        'No video file was produced — it may exceed the size cap or be unavailable.',
        'NO_VIDEO',
      );
    }
    const finalName = uniqueName(dir, safeVideoName(produced[0]));
    fs.renameSync(path.join(tmp, produced[0]), path.join(dir, finalName));
    makePoster(dir, finalName);
    return finalName;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Download a video into the deck's videos/ folder, generate a poster, and make sure the
 * .video-embed style exists. Returns the stored video.
 */
export async function downloadVideo(id: string, url: string): Promise<VideoInfo> {
  requireDeck(id);
  const finalName = await downloadVideoToDir(videosDir(id), url);
  ensureVideoStyles(id);
  return infoFor(id, finalName);
}
