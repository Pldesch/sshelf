import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';
import { PORT } from '../config';
import { deckExists } from './paths';
import { loadDeck } from '../deck/splice';
import { chromeBinary } from './export';
import { HttpError } from '../errors';

const execFileP = promisify(execFile);

/** The deck's logical (CSS) coordinate space — reveal renders at 1280×720. */
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
/** Render at 2× so text/edges are supersampled, then downscale when encoding — this is
 *  what makes the output crisp rather than showing compression artifacts. */
const DEVICE_SCALE = 2;
/** Output resolution (full HD, downscaled from the 2× capture). */
const OUT_W = 1920;
const OUT_H = 1080;
/** Let fonts, layout and the slide's initial charts settle before recording. */
const SETTLE_MS = 1500;
/** A segment is captured in real time so continuous animations (canvas/JS, charts)
 *  are recorded fully. We stop a segment early only once the page goes *static* — no
 *  new painted frame for this long — so static fragment-holds don't waste wall-clock. */
const IDLE_BREAK_MS = 350;
/** Always capture at least this much of a segment before an early static break, so a
 *  just-triggered animation is never cut off before it starts painting. */
const MIN_SEG_CAPTURE_MS = 250;
/** Per-segment hold bounds (ms). */
const MIN_HOLD = 100;
const MAX_HOLD = 60_000;
/** Whole-timeline ceiling so one export can't run forever. */
const MAX_TOTAL_MS = 5 * 60_000;

export interface VideoExportOpts {
  /** Hold time (ms) for each timeline segment: [base, afterStep1, afterStep2, …]. */
  durations: number[];
  /** Output frame rate. */
  fps: number;
}

function ffmpegBin(): string {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}

/** Validate + clamp the requested timeline; throws on obviously bad input. */
function sanitize(opts: VideoExportOpts): { durations: number[]; fps: number } {
  const durations = Array.isArray(opts.durations) ? opts.durations : [];
  if (durations.length === 0) throw new HttpError(400, 'durations required', 'INVALID_TIMELINE');
  if (durations.length > 80) throw new HttpError(400, 'Too many steps', 'INVALID_TIMELINE');
  const clamped = durations.map((d) => {
    const n = Number(d);
    if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid duration', 'INVALID_TIMELINE');
    return Math.min(MAX_HOLD, Math.max(MIN_HOLD, Math.round(n)));
  });
  const total = clamped.reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL_MS) throw new HttpError(400, 'Timeline too long (max 5 min)', 'INVALID_TIMELINE');
  const fps = [24, 30, 60].includes(opts.fps) ? opts.fps : 30;
  return { durations: clamped, fps };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Render a single slide (with its fragment animations) to an MP4 by driving the real
 * deck in headless Chrome: navigate to the slide, settle, then advance one fragment
 * per timeline segment, holding each for its configured duration. The page is
 * captured via the DevTools screencast (so chart + fragment animations are real
 * painted frames), then muxed to a constant-FPS MP4 with ffmpeg. Returns the file path.
 */
export async function exportSlideVideo(
  deckId: string,
  slideKey: string,
  rawOpts: VideoExportOpts,
): Promise<string> {
  if (!deckExists(deckId)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
  const { durations, fps } = sanitize(rawOpts);

  const { model } = loadDeck(deckId);
  // reveal skips data-visibility="hidden" slides, so navigate by the *visible* index
  // (count of non-hidden slides before this one) to land on the right slide.
  let slideIndex = -1;
  let visible = 0;
  for (const s of model.slides) {
    if (s.key === slideKey) {
      slideIndex = visible;
      break;
    }
    if (s.attrs.visibility !== 'hidden') visible += 1;
  }
  if (slideIndex < 0) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');

  const framesDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-vid-'));
  const url = `http://localhost:${PORT}/decks/${encodeURIComponent(deckId)}/presentation.html`;

  const browser = await puppeteer.launch({
    executablePath: chromeBinary(),
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', `--window-size=${VIEWPORT_W},${VIEWPORT_H}`],
    defaultViewport: { width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: DEVICE_SCALE },
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const r = (globalThis as unknown as { Reveal?: { isReady?: () => boolean } }).Reveal;
        return !!r && typeof r.isReady === 'function' && r.isReady();
      },
      { timeout: 30_000 },
    );
    // Hide reveal's built-in nav arrows, mouse-nav zones and the share button so none of
    // the presenting chrome appears in the exported video (the share button also self-hides
    // under navigator.webdriver, but keep this as a belt-and-suspenders guard).
    await page.addStyleTag({
      content: '.reveal .controls, .reveal .nav-zone, .reveal .deck-share { display: none !important; }',
    });
    // Land on the target slide with all fragments hidden, then let it settle.
    await page.evaluate(
      (idx) =>
        (globalThis as unknown as { Reveal: { slide: (h: number, v: number, f: number) => void } }).Reveal.slide(idx, 0, -1),
      slideIndex,
    );
    await wait(SETTLE_MS);

    // Configured timeline: segment i starts at S[i] and lasts durations[i].
    const S: number[] = [];
    let acc = 0;
    for (let i = 0; i < durations.length; i++) {
      S[i] = acc;
      acc += durations[i];
    }
    const totalMs = acc;

    // Start capturing painted frames. CDP screencast types drift between protocol
    // versions, so call send through a loose wrapper. Each kept frame is tagged with
    // the segment it was painted in and its wall-clock offset within that segment.
    // We ack *every* frame (so Chrome keeps streaming and we can detect when the page
    // goes static) but only write/keep frames at ~1.5× the output fps — enough for a
    // smooth result while avoiding disk/event-loop backpressure on long animations.
    const client = await page.createCDPSession();
    const cdpSend = (method: string, params?: Record<string, unknown>) =>
      (client.send as unknown as (m: string, p?: Record<string, unknown>) => Promise<unknown>)(method, params);
    const frames: { file: string; seg: number; offset: number }[] = [];
    const writes: Promise<unknown>[] = [];
    const keepInterval = 1000 / Math.min(Math.round(fps * 1.5), 60);
    let seq = 0;
    let currentSeg = 0;
    let lastFrameAt = performance.now();
    let lastKeptAt = -Infinity;
    const segStart: number[] = [];
    client.on('Page.screencastFrame', (frame: { data: string; sessionId: number }) => {
      const now = performance.now();
      lastFrameAt = now; // any painted frame — used for static detection
      cdpSend('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      if (now - lastKeptAt < keepInterval) return; // throttle writes to the target rate
      lastKeptAt = now;
      const offset = now - (segStart[currentSeg] ?? now);
      const file = path.join(framesDir, `f-${String(++seq).padStart(6, '0')}.jpg`);
      frames.push({ file, seg: currentSeg, offset });
      writes.push(fsp.writeFile(file, Buffer.from(frame.data, 'base64')).catch(() => {}));
    });
    await cdpSend('Page.startScreencast', { format: 'jpeg', quality: 100, everyNthFrame: 1 });

    // Advance one fragment per segment and capture it in real time. Continuous
    // animations record for the whole hold; a segment that paints nothing new for
    // IDLE_BREAK_MS is treated as a static hold and ends early (saving wall-clock).
    for (let i = 0; i < durations.length; i++) {
      if (i > 0) {
        await page.evaluate(
          () => (globalThis as unknown as { Reveal: { nextFragment: () => boolean } }).Reveal.nextFragment(),
        );
      }
      currentSeg = i;
      segStart[i] = performance.now();
      const segEnd = segStart[i] + durations[i];
      const minCapture = Math.min(durations[i], MIN_SEG_CAPTURE_MS);
      for (;;) {
        await wait(80);
        const now = performance.now();
        if (now >= segEnd) break;
        if (now - segStart[i] >= minCapture && now - lastFrameAt >= IDLE_BREAK_MS) break;
      }
    }
    await cdpSend('Page.stopScreencast').catch(() => {});
    await wait(120); // drain any in-flight frame
    await Promise.all(writes);

    if (frames.length === 0) {
      throw new HttpError(500, 'No frames were captured', 'CAPTURE_FAILED');
    }

    // Place each frame on the *configured* timeline: animation frames keep their real
    // intra-segment offset (clamped to the segment), so the output is exactly
    // sum(durations) long regardless of how long capture actually took.
    const placed = frames
      .map((f) => ({ file: f.file, t: S[f.seg] + Math.min(Math.max(0, f.offset), durations[f.seg]) }))
      .sort((a, b) => a.t - b.t);

    // Emit an exact constant-FPS frame sequence: for each tick, symlink the frame that
    // is active at that moment. This is deterministic (output = numFrames / fps),
    // unlike the concat demuxer's per-frame `duration` which ffmpeg honours unreliably.
    const seqDir = path.join(framesDir, 'seq');
    await fsp.mkdir(seqDir);
    const numFrames = Math.max(1, Math.round((totalMs / 1000) * fps));
    let ptr = 0;
    for (let k = 0; k < numFrames; k++) {
      const tk = (k / fps) * 1000;
      while (ptr + 1 < placed.length && placed[ptr + 1].t <= tk) ptr++;
      await fsp.symlink(placed[ptr].file, path.join(seqDir, `f-${String(k).padStart(6, '0')}.jpg`));
    }

    const out = path.join(os.tmpdir(), `studio-${deckId}-${slideKey}-${Date.now()}.mp4`);
    await execFileP(
      ffmpegBin(),
      [
        '-y',
        '-framerate', String(fps),
        '-i', path.join(seqDir, 'f-%06d.jpg'),
        '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos,format=yuv420p`,
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '17',
        '-movflags', '+faststart',
        out,
      ],
      { cwd: seqDir, timeout: 180_000 },
    );
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      throw new HttpError(500, 'Video encoding produced no file', 'ENCODE_FAILED');
    }
    return out;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, `Video export failed: ${(e as Error).message}`, 'EXPORT_FAILED');
  } finally {
    await browser.close().catch(() => {});
    await fsp.rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
}
