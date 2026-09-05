// Shared types between the studio server and client.

export interface SlideAttrs {
  class?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundGradient?: string;
  transition?: string;
  transitionSpeed?: string;
  autoAnimate?: boolean;
  state?: string;
  /** reveal.js data-visibility: "hidden" removes the slide from the presentation
   *  (kept in the source + studio sidenav); "uncounted" shows it but skips numbering. */
  visibility?: string;
}

/** A reveal.js `<section>` located by exact byte offsets into the source file. */
export interface Slide {
  /** Stable key for addressing the slide via the API (id, or a synthesized fallback). */
  key: string;
  id: string;
  /** Offsets into the deck HTML source. */
  startOffset: number;
  endOffset: number;
  openTagStart: number;
  openTagEnd: number;
  attrs: SlideAttrs;
  /** Exact source bytes `raw.slice(startOffset, endOffset)`. */
  rawHtml: string;
  /** Best-effort text snippet for the navigator. */
  title: string;
}

export interface DeckModel {
  deckId: string;
  title: string;
  /** Range inside `<div class="slides"> ... </div>` (for appending slides). */
  slidesInner: { startOffset: number; endOffset: number };
  slides: Slide[];
  /** sha256 of the raw file, for optimistic-concurrency on writes. */
  contentHash: string;
}

export interface DeckSummary {
  id: string;
  title: string;
  slideCount: number;
  mtime: number;
}

/** Deck-wide defaults from the `Reveal.initialize({…})` call. */
export interface DeckConfig {
  transition: string;
  transitionSpeed: string;
}

/** A restorable snapshot of a deck's presentation.html, taken before a change. */
export interface Snapshot {
  /** Opaque id (also the snapshot filename stem). */
  id: string;
  /** Epoch ms when it was taken. */
  ts: number;
  /** Human label describing the change that followed this state. */
  label: string;
  /** Byte size of the snapshot. */
  size: number;
}

/** An image stored in a deck's `images/` folder. */
export interface ImageInfo {
  /** File name within the deck's images folder. */
  name: string;
  /** Absolute URL to fetch it (served by the studio server). */
  url: string;
  /** Path to reference it from slide HTML (relative to the deck's presentation.html). */
  ref: string;
  size: number;
  mtime: number;
}

/** A video stored in a deck's `videos/` folder (downloaded from YouTube et al.). */
export interface VideoInfo {
  /** File name within the deck's videos folder. */
  name: string;
  /** Absolute URL to fetch it (served by the studio server). */
  url: string;
  /** Path to reference it from slide HTML (relative to the deck's presentation.html). */
  ref: string;
  /** Path to a poster frame (relative to presentation.html), if one was generated. */
  poster?: string;
  /** Absolute URL of the poster frame, if any. */
  posterUrl?: string;
  size: number;
  mtime: number;
}

export type CssVarKind = 'color' | 'length' | 'font' | 'other';

export interface CssVar {
  name: string;
  value: string;
  kind: CssVarKind;
  label: string;
}

/** A fragment-capable child element inside a slide (for the animation panel). */
export interface FragmentElement {
  /** Index among the slide's animatable descendants — used to address it on write. */
  elementIndex: number;
  tag: string;
  snippet: string;
  isFragment: boolean;
  effects: string[];
  fragmentIndex?: number;
}

// --- Animation vocabulary (reveal.js + brand extras) ---
/** Element tags eligible to become fragments (mirrored by server + client). */
export const ANIMATABLE_TAGS = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'blockquote', 'figure', 'table', 'ul', 'ol',
] as const;

/** Class words that mark a <div> as a structural/layout wrapper, not an animation target. */
const LAYOUT_WORDS = new Set([
  'content', 'container', 'wrapper', 'row', 'col', 'column', 'columns', 'cols',
  'grid', 'flex', 'stack', 'group', 'inner', 'header', 'head', 'footer', 'foot',
  'body', 'media', 'meta', 'stats', 'toolbar', 'controls', 'nav', 'layout',
  'slides', 'reveal', 'spacer',
]);

/**
 * Whether an element should be offered as an animation (fragment) target.
 * Shared by the server's fragment collector and the client's hover-highlight so the
 * element-index contract between them stays in lockstep.
 *
 * - anything already carrying `fragment` (so existing fragments are always editable),
 * - the content tags above,
 * - styled block <div>s (cards, callouts, panels) — but NOT pure layout wrappers,
 *   whose class is built from structural words like `content` / `head` / `grid`.
 */
export function isAnimatableElement(tag: string, classNames: string[]): boolean {
  const t = tag.toLowerCase();
  if (classNames.includes('fragment')) return true;
  if ((ANIMATABLE_TAGS as readonly string[]).includes(t)) return true;
  if (t === 'div' && classNames.length > 0) {
    const words = classNames.flatMap((c) => c.split(/[-_]/));
    return !words.some((w) => LAYOUT_WORDS.has(w));
  }
  return false;
}

export const TRANSITIONS = ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'] as const;
export const TRANSITION_SPEEDS = ['default', 'fast', 'slow'] as const;
export const FRAGMENT_EFFECTS = [
  'fade-in', 'fade-out',
  'fade-up', 'fade-down', 'fade-left', 'fade-right',
  'highlight-red', 'highlight-green', 'highlight-blue',
  'grow', 'shrink', 'strike',
  'rise', 'pop',
] as const;

/** Brand background presets — class + matching data-background-color set together. */
export const BACKGROUND_PRESETS = [
  { label: 'Purple', class: 'on-purple', color: '#5b24b9' },
  { label: 'Pink', class: 'on-pink', color: '#fea9c6' },
  { label: 'Section divider', class: 'section-divider', color: '#5b24b9' },
] as const;

export type DeckStructurePreset = string; // e.g. "1,1,d,3,1"

// --- Themes ---
// A theme is a reusable brand blueprint: a palette + fonts (materialized into each
// deck's styles.css as a managed :root block) plus standard slide templates. See
// docs/theme-system-plan.md.

/** The `:root` variables a theme governs — palette + fonts + type scale. Layout vars
 *  (--slide-padding, --content-gap, --box-radius) stay deck-local on purpose. */
export const THEME_VAR_NAMES = [
  // Colors
  '--primary-color',
  '--secondary-color',
  '--accent-purple',
  '--ink',
  '--background-color',
  '--section-divider-bg',
  '--text-color',
  '--muted-color',
  '--line-color',
  // Fonts
  '--heading-font',
  '--body-font',
  '--mono-font',
  // Type scale
  '--base-font-size',
  '--text-size',
  '--h1-size',
  '--h2-size',
  '--h3-size',
  '--footnote-size',
] as const;

/** Sentinel comments delimiting the theme's managed `:root` block inside a deck's
 *  styles.css. Shared so the deck CSS engine and the theme engine agree on them. */
export const THEME_BLOCK_START = '@studio-theme';
export const THEME_BLOCK_END = '@end-studio-theme';

export interface ThemeVar {
  name: string;
  value: string;
}

/** A fillable slot in a theme standard slide (e.g. the intro's title / speaker). `image`
 *  holds an image ref: the default is a theme asset (assets/NAME); on insert it can be
 *  kept or replaced with one of the deck's images (images/NAME). */
export interface ThemePlaceholder {
  key: string;
  label: string;
  default: string;
  type?: 'text' | 'multiline' | 'image';
}

/** A theme standard slide: one `<section>` template with `{{key}}` placeholders. */
export interface ThemeSlideTemplate {
  slug: string;
  name: string;
  placeholders: ThemePlaceholder[];
  /** The template HTML (a single `<section>` with `{{key}}` tokens). */
  html: string;
}

export interface ThemeSlideSummary {
  slug: string;
  name: string;
  placeholderCount: number;
}

/** An asset (image or video) in a theme's shared `assets/` folder. */
export interface ThemeAsset {
  name: string;
  kind: 'image' | 'video';
  /** Absolute URL served by the studio (e.g. /themes/<id>/assets/<name>). */
  url: string;
  /** Path to reference it from a theme slide template (assets/<name>). */
  ref: string;
  /** Poster frame URL for videos, if one was generated. */
  posterUrl?: string;
  size: number;
  mtime: number;
}

/** Full theme as served to the client. */
export interface Theme {
  id: string;
  name: string;
  description: string;
  /** Google-Fonts (or other) `@import` URL the theme's fonts come from, if any. */
  fontImport: string | null;
  /** Palette + font variables, in display order. */
  vars: ThemeVar[];
  slides: ThemeSlideSummary[];
  updatedAt: number;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  varCount: number;
  slideCount: number;
}

/** A deck's relationship to its theme, derived from its styles.css managed block. */
export interface DeckThemeState {
  /** The theme the deck is associated with, or null if none. */
  themeId: string | null;
  themeName: string | null;
  /** Managed-block hash matches the theme's current hash. */
  inSync: boolean;
  /** The deck references a theme that no longer exists on disk. */
  missing: boolean;
  /** Deck `:root` vars that differ from the theme (i.e. genuine overrides). */
  overrides: ThemeVar[];
}

// --- Agent jobs (parallel fleet) ---
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export type JobKind = 'edit' | 'create';

/** How many agents run at once per deck; the rest wait in the queue. */
export const AGENT_CONCURRENCY = 3;

export interface Job {
  id: string;
  deckId: string;
  kind: JobKind;
  /** For edit jobs: the slide key being worked on. Null for create jobs. */
  targetKey: string | null;
  /** Human label for the target, e.g. "#intro" or "New slide". */
  targetLabel: string;
  /** Groups jobs created together by "generate multiple slides" (null for one-offs). */
  batchId: string | null;
  prompt: string;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** Best-effort key of the slide that was edited (null for create). */
  resultSlideKey: string | null;
}

// --- WebSocket protocol ---
export type ServerMessage =
  | { type: 'deck-changed'; deckId: string; file: string }
  | { type: 'jobs-snapshot'; deckId: string; jobs: Job[] }
  | { type: 'job-update'; deckId: string; job: Job }
  | { type: 'job-log'; deckId: string; jobId: string; kind: string; text: string };

export type ClientMessage =
  | { type: 'subscribe'; deckId: string }
  | { type: 'unsubscribe'; deckId: string };
