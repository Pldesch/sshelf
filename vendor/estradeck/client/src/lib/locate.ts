import type { CSSProperties } from 'react';
import type { DeckModel, Slide } from '@studio/shared';

/** A slide with data-visibility="hidden" is removed from the presentation by reveal. */
export function isSlideHidden(slide: Slide): boolean {
  return slide.attrs.visibility === 'hidden';
}

/**
 * Map a slide key to its reveal.js horizontal index. reveal skips hidden slides, so the
 * index counts only visible slides. Returns null for a hidden slide (no reveal position).
 */
export function locate(model: DeckModel, key: string): { h: number; v: number } | null {
  let h = 0;
  for (const s of model.slides) {
    if (s.key === key) return isSlideHidden(s) ? null : { h, v: 0 };
    if (!isSlideHidden(s)) h += 1;
  }
  return null;
}

/** Reverse of locate: reveal.js horizontal index (visible slides only) -> slide key. */
export function keyAt(model: DeckModel, h: number): string | null {
  let i = 0;
  for (const s of model.slides) {
    if (isSlideHidden(s)) continue;
    if (i === h) return s.key;
    i += 1;
  }
  return null;
}

/** Slide keys in navigator order. */
export function flatKeys(model: DeckModel): string[] {
  return model.slides.map((s) => s.key);
}

/** Resolve a query value (slide id or key) to a slide key, or null if not found. */
export function resolveKey(model: DeckModel, q: string): string | null {
  const s = model.slides.find((sl) => sl.key === q || sl.id === q);
  return s ? s.key : null;
}

/** Find a slide by key. */
export function findSlide(model: DeckModel, key: string): Slide | null {
  return model.slides.find((s) => s.key === key) ?? null;
}

/** Background swatch color implied by a slide's attrs / brand classes. */
export function slideBackground(slide: Slide): string {
  if (slide.attrs.backgroundColor) return slide.attrs.backgroundColor;
  const cls = slide.attrs.class ?? '';
  if (/\bon-pink\b/.test(cls)) return '#fea9c6';
  if (/\bon-purple\b/.test(cls) || /\bsection-divider\b/.test(cls)) return '#5b24b9';
  if (/\bon-dark\b/.test(cls)) return '#000019';
  return '#ffffff';
}

/** CSS style for a slide's background swatch: image, gradient, or solid colour. */
export function slideBackgroundStyle(slide: Slide, deckId: string): CSSProperties {
  const a = slide.attrs;
  if (a.backgroundImage) {
    const raw = a.backgroundImage;
    const url = /^(https?:)?\/\//.test(raw) || raw.startsWith('/') ? raw : `/decks/${deckId}/${raw}`;
    return {
      backgroundColor: slideBackground(slide),
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (a.backgroundGradient) {
    return { backgroundImage: a.backgroundGradient };
  }
  return { background: slideBackground(slide) };
}
