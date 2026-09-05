import { parse, parseFragment } from 'parse5';
import type { DeckModel, Slide, SlideAttrs } from '@studio/shared';
import { hashContent } from './io';
import { HttpError } from '../errors';

// parse5's tree types are awkward to thread through; we use loose `any` traversal
// internally and keep the exported API strongly typed.
type AnyNode = any;

function isElement(node: AnyNode): boolean {
  return !!node && typeof node.tagName === 'string';
}

function childNodes(node: AnyNode): AnyNode[] {
  return node && node.childNodes ? node.childNodes : [];
}

function getAttr(el: AnyNode, name: string): string | undefined {
  const a = el.attrs?.find((x: AnyNode) => x.name === name);
  return a ? a.value : undefined;
}

function hasAttr(el: AnyNode, name: string): boolean {
  return !!el.attrs?.some((x: AnyNode) => x.name === name);
}

function classList(el: AnyNode): string[] {
  return (getAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

function findElement(node: AnyNode, pred: (el: AnyNode) => boolean): AnyNode | null {
  if (isElement(node) && pred(node)) return node;
  for (const c of childNodes(node)) {
    const found = findElement(c, pred);
    if (found) return found;
  }
  return null;
}

function sectionChildren(el: AnyNode): AnyNode[] {
  return childNodes(el).filter((c: AnyNode) => isElement(c) && c.tagName === 'section');
}

function collectText(node: AnyNode, out: string[]): void {
  if (isElement(node)) {
    if (node.tagName === 'aside' || node.tagName === 'script' || node.tagName === 'style') return;
    for (const c of childNodes(node)) collectText(c, out);
  } else if (node && node.nodeName === '#text' && typeof node.value === 'string') {
    const v = node.value.trim();
    if (v) out.push(v);
  }
}

function snippet(el: AnyNode): string {
  const heading = findElement(el, (e) => ['h1', 'h2', 'h3', 'h4'].includes(e.tagName));
  const target = heading ?? el;
  const out: string[] = [];
  collectText(target, out);
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function readAttrs(el: AnyNode): SlideAttrs {
  return {
    class: getAttr(el, 'class'),
    backgroundColor: getAttr(el, 'data-background-color'),
    backgroundImage: getAttr(el, 'data-background-image'),
    backgroundGradient: getAttr(el, 'data-background-gradient'),
    transition: getAttr(el, 'data-transition'),
    transitionSpeed: getAttr(el, 'data-transition-speed'),
    autoAnimate: hasAttr(el, 'data-auto-animate'),
    state: getAttr(el, 'data-state'),
    visibility: getAttr(el, 'data-visibility'),
  };
}

function buildSlideShallow(el: AnyNode, raw: string, key: string): Slide {
  const loc = el.sourceCodeLocation;
  if (!loc || !loc.startTag) {
    throw new HttpError(422, 'Deck not parseable: a <section> has no source location', 'DECK_NOT_PARSEABLE');
  }
  return {
    key,
    id: getAttr(el, 'id') ?? '',
    startOffset: loc.startOffset,
    endOffset: loc.endOffset,
    openTagStart: loc.startTag.startOffset,
    openTagEnd: loc.startTag.endOffset,
    attrs: readAttrs(el),
    rawHtml: raw.slice(loc.startOffset, loc.endOffset),
    title: snippet(el),
  };
}

function extractTitle(doc: AnyNode): string | undefined {
  const titleEl = findElement(doc, (e) => e.tagName === 'title');
  if (!titleEl) return undefined;
  const out: string[] = [];
  collectText(titleEl, out);
  const t = out.join(' ').trim();
  return t || undefined;
}

/** Parse a deck's HTML source into a model addressed by exact byte offsets. */
export function parseDeck(deckId: string, raw: string): DeckModel {
  const doc = parse(raw, { sourceCodeLocationInfo: true });
  const slidesEl = findElement(doc, (el) => el.tagName === 'div' && classList(el).includes('slides'));
  const loc = slidesEl?.sourceCodeLocation;
  if (!slidesEl || !loc?.startTag || !loc?.endTag) {
    throw new HttpError(422, 'Deck not parseable: missing <div class="slides">', 'DECK_NOT_PARSEABLE');
  }

  const used = new Set<string>();
  const keyFor = (el: AnyNode, fallback: string): string => {
    const id = getAttr(el, 'id');
    if (id && !used.has(id)) {
      used.add(id);
      return id;
    }
    used.add(fallback);
    return fallback;
  };

  const topSections = sectionChildren(slidesEl);
  const slides: Slide[] = topSections.map((el, i) => buildSlideShallow(el, raw, keyFor(el, `s${i}`)));

  if (slides.length === 0) {
    throw new HttpError(422, 'Deck not parseable: no slides found', 'DECK_NOT_PARSEABLE');
  }

  return {
    deckId,
    title: extractTitle(doc) ?? deckId,
    slidesInner: { startOffset: loc.startTag.endOffset, endOffset: loc.endTag.startOffset },
    slides,
    contentHash: hashContent(raw),
  };
}

export function countSlides(model: DeckModel): number {
  return model.slides.length;
}

/** True when `html` is exactly one top-level <section> (ignoring whitespace). */
export function isSingleSection(html: string): boolean {
  const frag = parseFragment(html);
  const elements = childNodes(frag).filter((c: AnyNode) => isElement(c));
  return elements.length === 1 && elements[0].tagName === 'section';
}

export function findSlideByKey(model: DeckModel, key: string): Slide | null {
  return model.slides.find((s) => s.key === key) ?? null;
}
