import { useEffect, useRef } from 'react';
import { useStudio } from '../state/deckStore';
import { isTypingTarget } from '../lib/slideNav';
import { attachAltPicker, elementThemePath } from '../lib/previewHighlight';
import * as api from '../api/client';

/**
 * Center pane in theme mode: a live reveal.js render of the selected theme slide with its
 * default (sample) placeholder values, so its animations play exactly as on a real deck.
 * Arrow keys (← →, ↑ ↓, space) step the slide's fragment animations so you can test them.
 */
export function ThemePreview() {
  const themeId = useStudio((s) => s.currentThemeId);
  const slug = useStudio((s) => s.themeSlug);
  const nonce = useStudio((s) => s.themeNonce);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = themeId && slug ? `${api.themeSlidePreviewUrl(themeId, slug, {})}&n=${nonce}` : '';

  // Forward arrow keys to the iframe's Reveal so fragment animations can be stepped
  // (the iframe is same-origin, so Reveal is reachable). ← rewinds, → replays.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ';
      if (!back && !fwd) return;
      const reveal = (iframeRef.current?.contentWindow as unknown as { Reveal?: { next: () => void; prev: () => void } } | null)?.Reveal;
      if (!reveal) return;
      e.preventDefault();
      if (back) reveal.prev();
      else reveal.next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hold Alt to highlight a template element; Alt + left-click jumps to its source in the
  // Slide editor's template HTML so it can be edited directly.
  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    try {
      attachAltPicker(doc, (el) => {
        const path = elementThemePath(el);
        if (path) useStudio.getState().jumpToThemeElement(path);
      });
    } catch {
      /* cross-origin shouldn't happen for the same-origin theme preview */
    }
  };

  return (
    <section className="stage">
      <div className="stage-canvas">
        {src ? (
          <iframe
            ref={iframeRef}
            key={src}
            title="Theme slide preview"
            className="preview-frame"
            src={src}
            onLoad={handleLoad}
          />
        ) : (
          <div className="preview-hidden">
            <span className="preview-hidden-icon">◐</span>
            <span className="muted">Select a theme slide, or add one with ＋.</span>
          </div>
        )}
      </div>
    </section>
  );
}
