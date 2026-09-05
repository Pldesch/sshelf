import type { DeckModel } from '@studio/shared';
import { isAnimatableElement } from '@studio/shared';
import { findSlide, locate, keyAt, resolveKey } from './locate';

const HL = 'studio-hover-hl';
const STYLE_ID = 'studio-hover-style';

let lastEl: Element | null = null;
let lastFrom = -1;

function previewDoc(): Document | null {
  const iframe = document.querySelector('iframe.preview-frame') as HTMLIFrameElement | null;
  try {
    return iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `.${HL}{outline:3px solid #22d3ee !important;outline-offset:1px;background:rgba(34,211,238,.18) !important;box-shadow:0 0 0 5px rgba(34,211,238,.4) !important;border-radius:3px;}`;
  doc.head?.appendChild(s);
}

/** The rendered <section> for a slide key (by id, else by reveal indices). */
function sectionElement(doc: Document, model: DeckModel, key: string): Element | null {
  const slide = findSlide(model, key);
  if (slide?.id) {
    const byId = doc.getElementById(slide.id);
    if (byId) return byId;
  }
  const p = locate(model, key);
  if (!p) return null;
  const tops = doc.querySelectorAll('.slides > section');
  const top = tops[p.h] as Element | undefined;
  if (!top) return null;
  const childSections = Array.from(top.children).filter((c) => c.tagName === 'SECTION');
  return childSections.length ? childSections[p.v] ?? childSections[0] : top;
}

/** Pre-order DFS over a section, mirroring server collectAnimatable() via the shared predicate. */
function animatableElements(section: Element): Element[] {
  const out: Element[] = [];
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (isAnimatableElement(c.tagName, Array.from(c.classList))) out.push(c);
      walk(c);
    }
  };
  walk(section);
  return out;
}

function apply(doc: Document, target: Element): void {
  if (target === lastEl) return;
  ensureStyle(doc);
  if (lastEl) lastEl.classList.remove(HL);
  target.classList.add(HL);
  lastEl = target;
}

export function clearPreviewHighlight(): void {
  lastFrom = -1;
  if (lastEl) {
    lastEl.classList.remove(HL);
    lastEl = null;
  }
}

/**
 * Outline the element at a path of element-child indices from the slide's <section>.
 * `from` is the hovered element's source offset, used to skip recompute while hovering it.
 */
export function highlightPath(model: DeckModel, key: string, path: number[], from: number): void {
  if (from === lastFrom) return;
  const doc = previewDoc();
  if (!doc) return;
  const section = sectionElement(doc, model, key);
  if (!section) {
    clearPreviewHighlight();
    return;
  }
  let target: Element | null = section;
  for (const idx of path) {
    if (!target) break;
    target = (target.children[idx] as Element | undefined) ?? null;
  }
  if (!target) {
    clearPreviewHighlight();
    return;
  }
  apply(doc, target);
  lastFrom = from;
}

/** Outline a specific preview element. Reuses the same rectangle highlight as code-hover;
 *  the two never fire at once (the mouse is over either the editor or the preview), and
 *  clearPreviewHighlight() resets both. */
function highlightElement(el: Element): void {
  const doc = el.ownerDocument;
  if (doc) apply(doc, el);
}

/** Is this <section> a reveal slide (a horizontal slide, or a vertical-stack child)? */
function isSlideSection(sec: Element): boolean {
  const p = sec.parentElement;
  if (!p) return false;
  if (p.classList.contains('slides')) return true; // horizontal slide
  return p.tagName === 'SECTION' && !!p.parentElement?.classList.contains('slides'); // vertical child
}

/** The innermost slide <section> containing `el` (the slide it belongs to), or null. */
function slideSectionOf(el: Element): Element | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.tagName === 'SECTION' && isSlideSection(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** Topmost slide element at a viewport point, seen *through* reveal's overlays (edge
 *  nav-zones, controls, progress, share/badge) so Alt-picking targets real slide content. */
function slideElementAtPoint(doc: Document, x: number, y: number): Element | null {
  const stack = doc.elementsFromPoint(x, y) as Element[];
  for (const el of stack) if (slideSectionOf(el)) return el;
  return null;
}

/**
 * The clicked element's slide <section> plus its element-child index path from that
 * section — the inverse of {@link highlightPath}. The deck's auto-linker wraps inline
 * URLs in <a class="autolink"> at runtime; those aren't in the source HTML, so target the
 * parent and never count them as siblings, keeping the path aligned with offsetForPath's
 * source-only element count.
 */
function slideSectionAndPath(el: Element): { section: Element; path: number[] } | null {
  let start = el;
  while (start.classList?.contains('autolink') && start.parentElement) start = start.parentElement;

  const section = slideSectionOf(start);
  if (!section) return null;

  const path: number[] = [];
  let cur: Element | null = start;
  while (cur && cur !== section) {
    if (!cur.parentElement) return null;
    let idx = 0;
    for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (!sib.classList.contains('autolink')) idx++;
    }
    path.unshift(idx);
    cur = cur.parentElement;
  }
  if (cur !== section) return null;
  return { section, path };
}

/** Map a clicked deck-preview element to its slide key + path (feeds jumpToElement). */
export function elementPickInfo(model: DeckModel, el: Element): { key: string; path: number[] } | null {
  const sp = slideSectionAndPath(el);
  if (!sp) return null;
  const { section, path } = sp;

  // Prefer the section's id; fall back to its horizontal reveal index.
  const id = section.getAttribute('id');
  let key = id ? resolveKey(model, id) : null;
  if (!key) {
    const doc = section.ownerDocument;
    const tops = Array.from(doc.querySelectorAll('.slides > section'));
    let top: Element = section;
    while (top.parentElement && !top.parentElement.classList.contains('slides')) top = top.parentElement;
    const h = tops.indexOf(top);
    if (h >= 0) key = keyAt(model, h);
  }
  if (!key) return null;
  return { key, path };
}

/** Path from a theme-preview element to its template <section> (feeds jumpToThemeElement).
 *  A theme has a single template, so no slide key is needed — just the path. */
export function elementThemePath(el: Element): number[] | null {
  return slideSectionAndPath(el)?.path ?? null;
}

/**
 * Wire "Alt to pick" onto a preview iframe document: hold Alt to highlight the slide
 * element under the cursor (crosshair + rectangle), Alt + left-click to pick it. The
 * click is captured before reveal sees it; `onPick` receives the chosen element.
 */
export function attachAltPicker(doc: Document, onPick: (el: Element) => void): void {
  const clear = () => {
    clearPreviewHighlight();
    if (doc.body) doc.body.style.cursor = '';
  };
  doc.addEventListener('mousemove', (e: MouseEvent) => {
    const el = e.altKey ? slideElementAtPoint(doc, e.clientX, e.clientY) : null;
    if (el) {
      highlightElement(el);
      if (doc.body) doc.body.style.cursor = 'crosshair';
    } else {
      clear();
    }
  });
  doc.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (!e.altKey || e.button !== 0) return;
      const el = slideElementAtPoint(doc, e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      onPick(el);
    },
    true, // capture: beat reveal's own click handling
  );
  doc.addEventListener('mouseleave', clear);
  doc.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key === 'Alt') clear();
  });
}

/** Outline the Nth animatable element of a slide (for the Animation tab fragment list). */
export function highlightFragment(model: DeckModel, key: string, elementIndex: number): void {
  const doc = previewDoc();
  if (!doc) return;
  const section = sectionElement(doc, model, key);
  if (!section) {
    clearPreviewHighlight();
    return;
  }
  const el = animatableElements(section)[elementIndex];
  if (!el) {
    clearPreviewHighlight();
    return;
  }
  lastFrom = -1;
  apply(doc, el);
}
