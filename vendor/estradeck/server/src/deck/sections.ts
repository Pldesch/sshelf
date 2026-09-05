import { parse } from 'parse5';
import type { FragmentElement } from '@studio/shared';
import { FRAGMENT_EFFECTS, isAnimatableElement } from '@studio/shared';
import { HttpError } from '../errors';
import { readRaw, atomicWrite, hashContent } from './io';
import { htmlPath } from '../decks/paths';
import { parseDeck, findSlideByKey } from './parse';

const FRAGMENT_EFFECT_SET = new Set<string>(FRAGMENT_EFFECTS as readonly string[]);

type AnyNode = any;

function isEl(n: AnyNode): boolean {
  return !!n && typeof n.tagName === 'string';
}
function kids(n: AnyNode): AnyNode[] {
  return n?.childNodes ?? [];
}
function getAttr(el: AnyNode, name: string): string | undefined {
  const a = el.attrs?.find((x: AnyNode) => x.name === name);
  return a ? a.value : undefined;
}
function classes(el: AnyNode): string[] {
  return (getAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}
function textOf(el: AnyNode): string {
  const out: string[] = [];
  const walk = (n: AnyNode) => {
    if (isEl(n)) {
      if (['script', 'style', 'aside'].includes(n.tagName)) return;
      for (const c of kids(n)) walk(c);
    } else if (n?.nodeName === '#text' && typeof n.value === 'string') {
      const v = n.value.trim();
      if (v) out.push(v);
    }
  };
  walk(el);
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 50);
}

// --- open-tag attribute editing (byte-stable; only touches named attributes) ---
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function attrRe(name: string): RegExp {
  return new RegExp(`\\s*${escapeRe(name)}(?=[\\s=/>])(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`, 'i');
}
function insertAttr(tag: string, attr: string): string {
  const m = tag.match(/\s*\/?>\s*$/);
  if (!m) return tag;
  const i = tag.length - m[0].length;
  return `${tag.slice(0, i)} ${attr}${tag.slice(i)}`;
}

/** Apply attribute changes to a single open tag, leaving untouched attributes byte-identical. */
export function editOpenTag(
  openTag: string,
  changes: Record<string, string | boolean | null>,
): string {
  let tag = openTag;
  for (const [name, val] of Object.entries(changes)) {
    const re = attrRe(name);
    const has = re.test(tag);
    if (val === null || val === false) {
      if (has) tag = tag.replace(re, '');
    } else if (val === true) {
      if (!has) tag = insertAttr(tag, name);
    } else {
      const attr = `${name}="${String(val).replace(/"/g, '&quot;')}"`;
      tag = has ? tag.replace(re, ` ${attr}`) : insertAttr(tag, attr);
    }
  }
  return tag;
}

// --- fragment element location ---
function findSection(raw: string, key: string): { startOffset: number; node: AnyNode } | null {
  const model = parseDeck('_', raw);
  const slide = findSlideByKey(model, key);
  if (!slide) return null;
  const doc = parse(raw, { sourceCodeLocationInfo: true });
  let target: AnyNode = null;
  const visit = (n: AnyNode) => {
    if (target) return;
    if (isEl(n) && n.tagName === 'section' && n.sourceCodeLocation?.startOffset === slide.startOffset) {
      target = n;
      return;
    }
    for (const c of kids(n)) visit(c);
  };
  visit(doc);
  return target ? { startOffset: slide.startOffset, node: target } : null;
}

function collectAnimatable(section: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode) => {
    for (const c of kids(n)) {
      if (isEl(c)) {
        if (isAnimatableElement(c.tagName, classes(c))) out.push(c);
        walk(c);
      }
    }
  };
  walk(section);
  return out;
}

export function getFragmentElements(
  deckId: string,
  key: string,
): { elements: FragmentElement[]; contentHash: string } {
  const raw = readRaw(htmlPath(deckId));
  const found = findSection(raw, key);
  if (!found) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
  const elements = collectAnimatable(found.node).map((el, i) => {
    const cls = classes(el);
    const effects = cls.filter((c) => FRAGMENT_EFFECT_SET.has(c));
    const fi = getAttr(el, 'data-fragment-index');
    // For block divs, label by class (.tweet-card) so they're distinguishable from
    // the text inside them; for content tags, use a text snippet.
    const primary = cls.find((c) => c !== 'fragment' && !FRAGMENT_EFFECT_SET.has(c));
    const snippet =
      el.tagName === 'div' && primary ? `.${primary}` : textOf(el) || `<${el.tagName}>`;
    return {
      elementIndex: i,
      tag: el.tagName,
      snippet,
      isFragment: cls.includes('fragment'),
      effects,
      fragmentIndex: fi !== undefined ? Number(fi) : undefined,
    } satisfies FragmentElement;
  });
  return { elements, contentHash: hashContent(raw) };
}

export function patchFragment(
  deckId: string,
  key: string,
  elementIndex: number,
  fragment: boolean,
  effect: string,
  fragmentIndex: number | null,
  expectedHash?: string,
): string {
  const file = htmlPath(deckId);
  const raw = readRaw(file);
  const hash = hashContent(raw);
  if (expectedHash && expectedHash !== hash) {
    throw new HttpError(409, 'Deck changed on disk — reload to get the latest', 'CONFLICT');
  }
  const found = findSection(raw, key);
  if (!found) throw new HttpError(404, 'Slide not found', 'SLIDE_NOT_FOUND');
  const el = collectAnimatable(found.node)[elementIndex];
  if (!el?.sourceCodeLocation?.startTag) {
    throw new HttpError(404, 'Element not found', 'ELEMENT_NOT_FOUND');
  }
  const loc = el.sourceCodeLocation.startTag;
  const openTag = raw.slice(loc.startOffset, loc.endOffset);

  const base = classes(el).filter((c) => c !== 'fragment' && !FRAGMENT_EFFECT_SET.has(c));
  const changes: Record<string, string | boolean | null> = {};
  if (!fragment) {
    changes.class = base.length ? base.join(' ') : null;
    changes['data-fragment-index'] = null;
  } else {
    const cls = [...base, 'fragment'];
    if (effect && FRAGMENT_EFFECT_SET.has(effect)) cls.push(effect);
    changes.class = cls.join(' ');
    changes['data-fragment-index'] =
      fragmentIndex === null || fragmentIndex === undefined ? null : String(fragmentIndex);
  }

  const out =
    raw.slice(0, loc.startOffset) + editOpenTag(openTag, changes) + raw.slice(loc.endOffset);
  atomicWrite(file, out);
  return hashContent(out);
}
