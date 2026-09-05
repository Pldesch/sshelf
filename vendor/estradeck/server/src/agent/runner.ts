import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import type { Job } from '@studio/shared';
import { CLAUDE_BIN, SKILLS_ROOT, SKILL_DIR, REPO_ROOT } from '../config';
import { htmlPath, stylesPath } from '../decks/paths';
import { loadDeck, putSlide, addSlide } from '../deck/splice';
import { findSlideByKey, isSingleSection } from '../deck/parse';
import { summarizeAgentEvent } from './summarize';

const WORK_ROOT = path.join(REPO_ROOT, '.studio-work');

const CREATE_TEMPLATE = '<section>\n  <!-- build the new slide here -->\n</section>';

export interface JobResult {
  ok: boolean;
  error?: string;
  resultSlideKey?: string | null;
}

function buildPrompt(job: Job): string {
  const base = `You are crafting ONE slide for a reveal.js presentation (Syndicats brand).
Edit ONLY the file "slide.html" in the current working directory — it must stay exactly one <section> element (a single reveal.js slide). Do NOT create or edit any other file.
Context (READ-ONLY — never edit these): "DECK_CONTEXT.html" is the full current deck, and "styles.css" holds the brand variables and classes; match the deck's look.
If the instruction references another slide by #id (e.g. "like #products"), find that <section id="…"> in DECK_CONTEXT.html and use it as a structure/style reference.
Brand: slide backgrounds are only purple (#5b24b9, class "on-purple") or pink (#fea9c6, class "on-pink"); section dividers use class "section-divider". Follow the revealjs skill at ${SKILL_DIR}/SKILL.md.`;
  const task =
    job.kind === 'edit'
      ? `\n\nThis slide already exists in the deck. Apply this change in slide.html:\n${job.prompt}`
      : `\n\nCreate a brand-new slide in slide.html:\n${job.prompt}`;
  return `${base}${task}`;
}

/**
 * Run one slide job in an isolated workspace. The agent only writes `slide.html`;
 * when it finishes, the server merges that single slide back into the canonical deck
 * (byte-stable splice), so concurrent jobs on different slides never conflict.
 */
export function runJob(
  job: Job,
  onLog: (kind: string, text: string) => void,
  onExit: (result: JobResult) => void,
): ChildProcess {
  const deckId = job.deckId;
  const workDir = path.join(WORK_ROOT, job.id);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    fs.copyFileSync(stylesPath(deckId), path.join(workDir, 'styles.css'));
  } catch {
    /* styles optional */
  }
  try {
    fs.copyFileSync(htmlPath(deckId), path.join(workDir, 'DECK_CONTEXT.html'));
  } catch {
    /* context optional */
  }

  // A targetKey means the slide (or reserved placeholder) already exists — start from it.
  let starter = CREATE_TEMPLATE;
  if (job.targetKey) {
    const slide = findSlideByKey(loadDeck(deckId).model, job.targetKey);
    if (slide) starter = slide.rawHtml;
  }
  const slideFile = path.join(workDir, 'slide.html');
  fs.writeFileSync(slideFile, `${starter}\n`, 'utf8');
  const starterTrim = starter.trim();

  const child = spawn(
    CLAUDE_BIN,
    [
      '-p',
      buildPrompt(job),
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--add-dir',
      SKILLS_ROOT,
    ],
    { cwd: workDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let settled = false;
  let hadError = false;
  let errMsg: string | undefined;

  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  const finalize = (result: JobResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    onExit(result);
  };

  child.on('error', (err: NodeJS.ErrnoException) => {
    errMsg =
      err.code === 'ENOENT'
        ? `Could not find the "claude" CLI (${CLAUDE_BIN}). Install Claude Code and log in.`
        : err.message;
    onLog('error', errMsg);
    finalize({ ok: false, error: errMsg });
  });

  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    let ev: any;
    try {
      ev = JSON.parse(t);
    } catch {
      return;
    }
    if (ev.type === 'result' && ev.is_error) {
      hadError = true;
      errMsg = errMsg ?? 'Agent reported an error';
    }
    const s = summarizeAgentEvent(ev);
    if (s) onLog(s.kind, s.text);
  });

  readline.createInterface({ input: child.stderr! }).on('line', (line) => {
    if (line.trim()) onLog('stderr', line);
  });

  child.on('close', (code) => {
    if (settled) return;
    if (code !== 0 && code !== null) {
      finalize({ ok: false, error: errMsg ?? `claude exited with code ${code}` });
      return;
    }
    if (hadError) {
      finalize({ ok: false, error: errMsg ?? 'Agent failed' });
      return;
    }

    let produced: string;
    try {
      produced = fs.readFileSync(slideFile, 'utf8').trim();
    } catch {
      finalize({ ok: false, error: 'slide.html was missing after the run' });
      return;
    }
    if (!isSingleSection(produced)) {
      finalize({ ok: false, error: 'Agent did not produce exactly one <section>' });
      return;
    }
    if (job.kind === 'create' && produced === starterTrim) {
      finalize({ ok: false, error: 'Agent produced no slide content' });
      return;
    }

    try {
      if (job.targetKey) {
        // Edit an existing slide, or fill a reserved placeholder — both replace in place.
        putSlide(deckId, job.targetKey, produced);
        finalize({ ok: true, resultSlideKey: job.targetKey });
      } else {
        addSlide(deckId, produced, null);
        finalize({ ok: true, resultSlideKey: null });
      }
    } catch (e) {
      finalize({ ok: false, error: (e as Error).message });
    }
  });

  return child;
}
