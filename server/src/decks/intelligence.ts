import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { REPO_ROOT } from '../config';
import { deckExists, stylesPath } from './paths';
import { listImages } from './images';
import { listVideos } from './videos';
import { loadDeck } from '../deck/splice';
import { HttpError } from '../errors';

// Slides Intelligence runs on a direct OpenAI call (fast, single-shot) — deliberately
// NOT the Claude CLI that powers agent mode, which needs its full agent runtime.
const SI_MODEL = process.env.SI_MODEL ?? 'gpt-5.4-mini';
// Inline prompt autocomplete uses the fastest/cheapest GPT-5.4-class model so it can
// run on every typing pause without adding noticeable latency.
const SI_COMPLETE_MODEL = process.env.SI_COMPLETE_MODEL ?? 'gpt-5.4-nano';

export interface SiRequest {
  /** Full source of the slide the cursor is in (one <section>). */
  code: string;
  /** The selected text to transform, if any. */
  selection?: string;
  /** Natural-language instruction. */
  prompt: string;
  /** compose = recompose the whole slide body (model decides placement); replace = rewrite the
   *  selection; section = rewrite the WHOLE <section> incl. its tag (so it can change the
   *  section's own inline style / class / data-* like the background). */
  mode: 'compose' | 'replace' | 'section';
}

// Static design-system + animation knowledge (the stable system prompt).
const SYSTEM = `You are "Slides Intelligence", an inline assistant inside a reveal.js slide editor for the Syndicats brand. You write small, polished chunks of slide HTML on request.

BRAND & DESIGN SYSTEM
- Slide backgrounds are only purple (#5b24b9, class "on-purple") or pink (#fea9c6, class "on-pink"). On pink, headings are black.
- Use the deck's own CSS variables and classes (listed below) instead of hard-coded values — e.g. var(--primary-color), var(--secondary-color), and existing component classes.
- Match the deck's existing voice and structure (an example of the current slide is given).

ANIMATION (within a single slide only)
- Reveal one element at a time with class="fragment". Effects: fade-in (default), fade-up, fade-down, fade-left, fade-right, fade-out, semi-fade-out, grow, shrink, highlight-red, highlight-green, highlight-blue. Order with data-fragment-index="N".
- NEVER use data-auto-animate — that needs two separate slides and is out of scope here.

CHARTS (Apache ECharts, brand-aware runtime)
- Add a chart with: <div data-echart style="position:absolute;inset:0;" data-spec='{ ...echarts option... }'></div>. The runtime injects brand colors/fonts; reveal fragments drive progressive series reveals via a per-series "step".

IMAGES
- Reference repository images ONLY by a ref from the provided list, e.g. <img src="images/NAME.png">. NEVER invent an image path. If no suitable image is available, use a styled placeholder element (e.g. a colored <div>) instead of an <img>.

VIDEOS
- Reference repository videos ONLY by a ref from the provided list. NEVER invent a video path.
- Embed a video framed and brand-styled like this: <div class="video-embed"><video data-autoplay controls playsinline src="videos/NAME.mp4" poster="videos/NAME.jpg"></video></div>. Include the poster attribute only when a poster ref is listed for that video.
- data-autoplay makes reveal play it when the slide is shown and pause it on leave. For a full-bleed background video instead, the section needs data-background-video — but you only output inner HTML, so prefer the framed .video-embed form.

SLIDES (reference other slides for consistency)
- The deck's other slides are listed below by #id with their titles. When the instruction references one by #id (e.g. "in the style of #products"), that slide's full HTML is provided under REFERENCED SLIDES — use it as a structure/style reference. Don't copy it verbatim unless asked.

OUTPUT RULES (critical)
- Output ONLY raw HTML. No markdown code fences, no backticks, no commentary, no <html>/<body>.
- Never output a <section> tag — your HTML is inserted INSIDE the existing slide's <section>.
- Produce just the requested chunk; keep it valid and self-contained.`;

function truncStyles(css: string): string {
  return css.length > 6000 ? css.slice(0, 6000) + '\n/* …truncated… */' : css;
}

function readStyles(deckId: string): string {
  try {
    return truncStyles(fs.readFileSync(stylesPath(deckId), 'utf8'));
  } catch {
    return '';
  }
}

/** Everything Slides Intelligence needs about the surrounding deck/theme to write a good
 *  chunk — gathered by the caller so the same engine serves both decks and theme templates. */
export interface SiContext {
  /** CSS design tokens (styles.css for a deck, theme.css for a theme). */
  styles: string;
  /** Available image refs (e.g. images/foo.png or assets/foo.png). */
  images: string[];
  /** Available videos with optional poster refs. */
  videos: { ref: string; poster?: string }[];
  /** Other slides referenceable by #id (decks only; empty for themes). */
  slides: { id: string; key: string; title: string; rawHtml: string }[];
  /** Theme-template mode: preserve {{placeholders}}; no cross-slide references. */
  isTheme?: boolean;
}

/** Build the SI context from a deck (its styles.css, images, videos, and slides). */
export function deckContext(deckId: string): SiContext {
  let slides: SiContext['slides'] = [];
  try {
    slides = loadDeck(deckId).model.slides.map((s) => ({
      id: s.id,
      key: s.key,
      title: s.title,
      rawHtml: s.rawHtml,
    }));
  } catch {
    /* unreadable deck — no slide references */
  }
  return {
    styles: readStyles(deckId),
    images: listImages(deckId).map((i) => i.ref),
    videos: listVideos(deckId).map((v) => ({ ref: v.ref, poster: v.poster })),
    slides,
  };
}

const THEME_NOTE = `\n\nTHEME TEMPLATE MODE\n- This is a REUSABLE THEME TEMPLATE, not a finished slide. Preserve every existing {{placeholder}} token (double curly braces) exactly as written; they are filled in per deck.\n- Where you add text a presenter would customise (a title, name, label…), use a new {{placeholder}} token instead of literal copy.\n- Reference images/videos as assets/NAME (the theme's own assets), never images/NAME.\n- There are no other slides to reference.`;

// Whole-section edits are the one case where the "never output a <section>" rule is lifted.
const SECTION_NOTE = `\n\nWHOLE-SECTION EDIT (this request only — this OVERRIDES the "never output a <section> tag" rule above): Output the COMPLETE <section …>…</section> element, including its opening tag. You MAY change the <section> tag's own class, style, and data-* attributes (e.g. data-background-color, data-background-image, its inline style) when the instruction calls for it. Keep its id unless told otherwise.`;

function buildMessages(ctx: SiContext, req: SiRequest): { system: string; user: string } {
  const images = ctx.images.map((ref) => `- ${ref}`).join('\n');
  const videos = ctx.videos.map((v) => `- ${v.ref}${v.poster ? ` (poster: ${v.poster})` : ''}`).join('\n');

  const slides = ctx.slides;
  const slideList = slides.map((s) => `- #${s.id || s.key}${s.title ? ` — ${s.title}` : ''}`).join('\n');
  const refIds = [...new Set([...req.prompt.matchAll(/#([\w-]+)/g)].map((m) => m[1]))];
  const referenced = refIds
    .map((rid) => slides.find((s) => s.id === rid || s.key === rid))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .slice(0, 6);

  const tokensLabel = ctx.isTheme ? 'THEME DESIGN TOKENS (theme.css)' : 'DECK DESIGN TOKENS (styles.css)';
  const system = [
    SYSTEM + (ctx.isTheme ? THEME_NOTE : '') + (req.mode === 'section' ? SECTION_NOTE : ''),
    `\n--- ${tokensLabel} ---\n${ctx.styles || '(none)'}`,
    `\n--- AVAILABLE IMAGES ---\n${images || '(none)'}`,
    `\n--- AVAILABLE VIDEOS ---\n${videos || '(none)'}`,
    `\n--- AVAILABLE SLIDES (reference by #id) ---\n${slideList || '(none)'}`,
  ].join('\n');

  const user = [`--- CURRENT SLIDE (for context, do not repeat it) ---\n${req.code}`];
  if (referenced.length) {
    user.push(
      `\n--- REFERENCED SLIDES (full HTML of the #ids you mentioned) ---\n${referenced
        .map((s) => `--- #${s.id || s.key}${s.title ? ` (${s.title})` : ''} ---\n${s.rawHtml}`)
        .join('\n\n')}`,
    );
  }
  if (req.mode === 'replace' && req.selection) {
    user.push(
      `\n--- SELECTED HTML TO REWRITE ---\n${req.selection}`,
      `\nRewrite the selected HTML per the instruction. Output ONLY the replacement HTML for that selection.`,
    );
  } else if (req.mode === 'section') {
    user.push(
      `\nRewrite the ENTIRE slide <section> to satisfy the instruction. Output the COMPLETE <section …>…</section> element INCLUDING its opening tag — you MAY change the section tag's class, style, and data-* attributes (e.g. data-background-color) when the instruction calls for it; keep its id unless told otherwise. Keep the existing content unless the instruction says to change or remove it.`,
    );
  } else {
    user.push(
      `\nRewrite the ENTIRE inner content of the slide to satisfy the instruction, deciding where any new content best fits within the existing layout and reading order. Keep the existing content unless the instruction says to change or remove it. Output ALL of the slide's inner HTML (everything inside the <section>) and NOT the <section> tag itself.`,
    );
  }
  user.push(`\n--- INSTRUCTION ---\n${req.prompt}\n\nOutput the HTML now:`);
  return { system, user: user.join('\n') };
}

/** Strip a single ```lang … ``` fence (or stray leading/trailing fences) the model may add. */
function stripFences(s: string): string {
  let t = s.trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fenced) return fenced[1].trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  return t.trim();
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  let apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Pick up a key added to .env after startup, without needing a server restart.
    try {
      process.loadEnvFile(path.join(REPO_ROOT, '.env'));
      apiKey = process.env.OPENAI_API_KEY;
    } catch {
      /* no .env file */
    }
  }
  if (!apiKey) {
    throw new HttpError(500, 'OPENAI_API_KEY is not set — add it to .env at the repo root.', 'NO_OPENAI_KEY');
  }
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

// --- Inline prompt autocomplete (ghost text) ------------------------------------

export interface SiCompleteRequest {
  /** The instruction text the user has typed so far. */
  prompt: string;
  mode: 'compose' | 'replace';
  /** Current slide source, for context-aware suggestions (optional). */
  code?: string;
}

const COMPLETE_SYSTEM = `You autocomplete a half-typed instruction a user is giving to an AI that edits a single reveal.js slide. Continue their text into a concrete, useful instruction.
RULES:
- Output ONLY the continuation — the exact text that comes AFTER what the user typed, ready to be appended verbatim. Never repeat their text.
- SPACING: begin with a single leading space when your continuation starts a NEW word (the common case). Use NO leading space only when you are finishing the word the user is mid-typing.
- Keep it short: finish the current phrase or clause (a few words; at most one short sentence).
- No quotes, no markdown, no commentary.
- Stay relevant to editing slides: content, layout, animations/fragments, charts, images, videos, colors, typography.
- If the user's text already reads as a complete instruction, output nothing.

Examples:
User typed: "make the heading"
Continuation: " larger and bold"
User typed: "make the headin"
Continuation: "g larger and bold"
User typed: "add a chart "
Continuation: "comparing revenue by quarter"`;

/** A compact, plain-text gist of the current slide so suggestions stay relevant. */
function slideGist(code?: string): string {
  if (!code) return '';
  const text = code.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/** Suggest a continuation of the user's half-typed SI prompt. Never throws — any
 *  problem (no API key, model error, abort) yields an empty suggestion so typing is
 *  never interrupted. */
export async function completePrompt(deckId: string, req: SiCompleteRequest): Promise<string> {
  if (!deckExists(deckId)) return '';
  return completePromptCore(req);
}

/** The deck-agnostic core of prompt ghost-completion (used by decks and themes). */
export async function completePromptCore(req: SiCompleteRequest): Promise<string> {
  const typed = (req.prompt ?? '').slice(0, 400);
  if (typed.trim().length < 3) return '';

  let oa: OpenAI;
  try {
    oa = client();
  } catch {
    return ''; // no OPENAI_API_KEY — silently offer no suggestion
  }

  const gist = slideGist(req.code);
  const context = `The user is ${req.mode === 'replace' ? 'editing a selected part of' : 'composing'} a slide.${
    gist ? ` Slide so far: ${gist}` : ''
  }`;

  let content: string | null | undefined;
  try {
    const res = await oa.chat.completions.create({
      model: SI_COMPLETE_MODEL,
      // GPT-5.4 uses 'none' (not 'minimal') for zero reasoning tokens = lowest latency.
      reasoning_effort: 'none',
      max_completion_tokens: 32,
      messages: [
        { role: 'system', content: COMPLETE_SYSTEM },
        { role: 'user', content: `${context}\n\nInstruction so far:\n${typed}\n\nContinuation:` },
      ],
    });
    content = res.choices[0]?.message?.content;
  } catch {
    return ''; // model/network error — don't break typing
  }

  let s = content ?? '';
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(s.trim());
  if (fence) s = fence[1];
  s = s.replace(/\s+$/, ''); // trim trailing whitespace ONLY — a leading space is meaningful
  s = s.replace(/^(["'`])([\s\S]*)\1$/, '$2'); // strip matching surrounding quotes, if any
  // If the model echoed the typed text, keep only the new tail.
  const body = s.replace(/^\s+/, '');
  if (body.toLowerCase().startsWith(typed.toLowerCase())) s = body.slice(typed.length);

  // Deterministic join (models are inconsistent about the leading space). This feature
  // continues the instruction with new words, so at a word↔word boundary we force a
  // single separating space; after a trailing space we never double it.
  if (typed.endsWith(' ')) {
    s = s.replace(/^\s+/, '');
  } else if (s && /[A-Za-z0-9]/.test(typed.slice(-1)) && /[A-Za-z0-9]/.test(s.replace(/^\s+/, '')[0] ?? '')) {
    s = ` ${s.replace(/^\s+/, '')}`;
  }
  return s;
}

// --- Multi-slide planner (decompose a topic into an ordered, coherent outline) ---

export interface SlideBrief {
  title: string;
  brief: string;
}

/**
 * Plan a coherent sequence of `count` slides for a topic. Returns ordered briefs that a
 * fan-out of agents then each turn into one slide. The shared outline is what keeps the
 * generated slides consistent and non-overlapping.
 */
export async function planSlides(deckId: string, topic: string, count: number): Promise<SlideBrief[]> {
  if (!deckExists(deckId)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
  if (!topic.trim()) throw new HttpError(400, 'A topic is required', 'NO_TOPIC');
  const n = Math.min(Math.max(1, Math.floor(count) || 0), 12);

  const oa = client(); // throws NO_OPENAI_KEY (500) if missing
  const system = `You plan a coherent sequence of exactly ${n} reveal.js slides for a Syndicats-brand deck. The slides must read as ONE narrative: logical order, no overlap or repetition, varied roles (e.g. intro, key point, example, data/chart, section divider, summary) as fitting the topic. Output ONLY JSON of the form {"slides":[{"title":"…","brief":"one or two sentences saying exactly what THIS slide contains and its role in the sequence"}]} with exactly ${n} items.`;
  const user = `Topic: ${topic}\n\n--- DECK STYLE CONTEXT (for tone; do not copy) ---\n${readStyles(deckId).slice(0, 1500) || '(none)'}\n\nReturn the JSON now:`;

  let content: string | null | undefined;
  try {
    const res = await oa.chat.completions.create({
      model: SI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    content = res.choices[0]?.message?.content;
  } catch (e) {
    throw new HttpError(502, `Planner request failed: ${(e as Error).message}`, 'PLAN_FAILED');
  }

  let parsed: { slides?: unknown };
  try {
    parsed = JSON.parse(stripFences(content ?? '{}'));
  } catch {
    throw new HttpError(502, 'Planner returned invalid JSON', 'PLAN_FAILED');
  }
  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const briefs: SlideBrief[] = slides
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        title: String(o.title ?? '').slice(0, 80).trim(),
        brief: String(o.brief ?? '').slice(0, 600).trim(),
      };
    })
    .filter((b) => b.brief)
    .slice(0, n);
  if (briefs.length === 0) throw new HttpError(502, 'Planner produced no slides', 'PLAN_EMPTY');
  return briefs;
}

/** Generate a slide-HTML chunk from a prepared context (deck or theme). */
export async function generateFromContext(ctx: SiContext, req: SiRequest): Promise<string> {
  if (!req.prompt.trim()) throw new HttpError(400, 'A prompt is required', 'NO_PROMPT');
  const oa = client(); // throws NO_OPENAI_KEY (500) if missing
  const { system, user } = buildMessages(ctx, req);

  let content: string | null | undefined;
  try {
    const res = await oa.chat.completions.create({
      model: SI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    content = res.choices[0]?.message?.content;
  } catch (e) {
    throw new HttpError(502, `OpenAI request failed: ${(e as Error).message}`, 'SI_FAILED');
  }

  const html = stripFences(content ?? '');
  if (!html) throw new HttpError(502, 'Slides Intelligence produced no HTML', 'SI_EMPTY');
  return html;
}

export async function generateSlideHtml(deckId: string, req: SiRequest): Promise<string> {
  if (!deckExists(deckId)) throw new HttpError(404, 'Deck not found', 'DECK_NOT_FOUND');
  return generateFromContext(deckContext(deckId), req);
}
