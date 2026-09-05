/**
 * Hide reveal.js's built-in nav arrows, the mouse-nav hover zones and the share button
 * inside a studio preview iframe — those are for actual presenting; in the studio you
 * navigate via the slide list. Only styles the iframe's document, so the deck file is
 * untouched and all three still work when the deck is presented normally. Safe to call
 * on every iframe load.
 */
export function hideRevealControls(win: Window | null | undefined): void {
  try {
    const doc = win?.document;
    if (!doc || doc.getElementById('studio-hide-controls')) return;
    const style = doc.createElement('style');
    style.id = 'studio-hide-controls';
    style.textContent =
      '.reveal .controls, .reveal .nav-zone, .reveal .deck-share { display: none !important; }';
    doc.head.appendChild(style);
  } catch {
    /* cross-origin or document not ready — ignore */
  }
}
