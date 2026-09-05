// Marquee region picker for the slide preview. Hold Shift+Cmd and drag a rectangle on the
// slide to capture context for the edit agent: the elements the rectangle covers, the
// region's position in the slide's own 1280×720 coordinate space, and the background color
// under it (resolved from the CSS, not sampled from pixels).

/** Which engine handles the region edit. 'si' = one-shot Slide Intelligence completion
 *  (applied in place, jumps to the Code editor); 'agent' = full agent job (Agents tab). */
export type RegionMode = 'si' | 'agent';

export interface RegionElement {
  /** Short label for the popover (tag/id + a little text). */
  label: string;
  /** Cleaned markup of the element (runtime autolinks unwrapped, reveal state classes
   *  stripped) — includes its inline styles so the model can see and edit them. */
  html: string;
  /** Computed text color (leaf text elements) — captures color set via a CSS class. */
  color?: string;
  /** Computed opaque background color, if any. */
  bg?: string;
}

export interface RegionContext {
  /** Region in the slide's own 1280×720 coordinate space. */
  px: { x: number; y: number; w: number; h: number };
  /** Region as percentages of the slide (resolution-independent). */
  pct: { left: number; top: number; right: number; bottom: number };
  /** Computed background color under the region (resolved from CSS, not a screenshot). */
  areaColor: string | null;
  elements: RegionElement[];
}

export interface RegionResult {
  /** Marquee rect in the iframe's viewport coords; the caller maps it to the parent. */
  anchor: { left: number; top: number; width: number; height: number };
  context: RegionContext;
}

const MARQUEE_ID = 'studio-region-marquee';
const SLIDE_W = 1280;
const SLIDE_H = 720;
const SKIP = new Set(['STYLE', 'SCRIPT', 'BR', 'SECTION', 'HTML', 'BODY']);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function rectOf(ax: number, ay: number, bx: number, by: number) {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

function ensureMarquee(doc: Document): HTMLElement {
  let el = doc.getElementById(MARQUEE_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = MARQUEE_ID;
    Object.assign(el.style, {
      position: 'fixed', zIndex: '99999', pointerEvents: 'none',
      border: '1.5px dashed #22d3ee', background: 'rgba(34,211,238,0.12)',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.25)', borderRadius: '2px',
    });
    doc.body.appendChild(el);
  }
  return el;
}

export function clearRegionMarquee(doc: Document): void {
  doc.getElementById(MARQUEE_ID)?.remove();
}

// Pulsing "working" state for the marquee while a Slide Intelligence one-shot runs, so the
// user can see it's still going after the (auto-dismissing) toast is gone.
const BUSY_STYLE_ID = 'studio-region-busy-style';

function ensureBusyStyle(doc: Document): void {
  if (doc.getElementById(BUSY_STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = BUSY_STYLE_ID;
  s.textContent =
    '@keyframes studioRegionPulse{0%{box-shadow:0 0 0 0 rgba(34,211,238,.55);border-color:#22d3ee}70%{box-shadow:0 0 0 9px rgba(34,211,238,0);border-color:#7a3cf6}100%{box-shadow:0 0 0 0 rgba(34,211,238,0);border-color:#22d3ee}}' +
    '@keyframes studioRegionSpin{to{transform:rotate(360deg)}}' +
    `#${MARQUEE_ID}.busy{animation:studioRegionPulse 1.15s ease-in-out infinite}` +
    `#${MARQUEE_ID} .studio-region-busy-label{position:absolute;left:0;top:-24px;display:flex;align-items:center;gap:6px;` +
    'background:#181826;border:1px solid #34344a;color:#22d3ee;font:11px Inter,system-ui,sans-serif;' +
    'padding:2px 9px;border-radius:999px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.4)}' +
    `#${MARQUEE_ID} .studio-region-busy-label::before{content:"✦";display:inline-block;animation:studioRegionSpin 1.15s linear infinite}`;
  doc.head?.appendChild(s);
}

/** Toggle the marquee's pulsing "LLM is working" animation (with a spinning label). */
export function setRegionMarqueeBusy(doc: Document, on: boolean): void {
  const m = doc.getElementById(MARQUEE_ID);
  if (!m) return;
  if (on) ensureBusyStyle(doc);
  m.classList.toggle('busy', on);
  let label = m.querySelector('.studio-region-busy-label');
  if (on && !label) {
    label = doc.createElement('div');
    label.className = 'studio-region-busy-label';
    label.textContent = 'Slide Intelligence…';
    m.appendChild(label);
  } else if (!on && label) {
    label.remove();
  }
}

// Crosshair cursor while Shift+Cmd is held / dragging, as a "you're drawing a region" hint.
// Applied via a class with !important so it wins over the Alt-picker's inline body cursor.
const CURSOR_STYLE_ID = 'studio-region-cursor';
const ACTIVE_CLASS = 'studio-region-active';

function setRegionCursor(doc: Document, on: boolean): void {
  if (on && !doc.getElementById(CURSOR_STYLE_ID)) {
    const s = doc.createElement('style');
    s.id = CURSOR_STYLE_ID;
    s.textContent = `.${ACTIVE_CLASS}, .${ACTIVE_CLASS} * { cursor: crosshair !important; }`;
    doc.head?.appendChild(s);
  }
  doc.documentElement.classList.toggle(ACTIVE_CLASS, on);
}

/** A computed color counts as "real" only if it isn't transparent / fully see-through. */
function isOpaque(c: string | null | undefined): c is string {
  if (!c || c === 'transparent') return false;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.length === 4 && parseFloat(parts[3]) === 0) return false;
  }
  return true;
}

/** First opaque background color in the stack at a point (the color the eye reads there). */
function backgroundUnder(doc: Document, win: Window, x: number, y: number): string | null {
  const stack = doc.elementsFromPoint(x, y) as Element[];
  for (const el of stack) {
    if (el.id === MARQUEE_ID) continue;
    const bg = win.getComputedStyle(el).backgroundColor;
    if (isOpaque(bg)) return bg;
  }
  return null;
}

// reveal adds these at runtime; strip them so the inlined markup matches the source.
const RUNTIME_CLASSES = new Set(['present', 'past', 'future', 'stack', 'visible', 'current-fragment']);

/** Element markup close to its source: runtime autolinks unwrapped, reveal state classes
 *  removed, whitespace collapsed, truncated. Keeps inline styles/attributes intact. */
function cleanOuterHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('a.autolink').forEach((a) => a.replaceWith(...Array.from(a.childNodes)));
  const strip = (n: Element) => {
    if (n.classList.length) {
      for (const c of Array.from(n.classList)) if (RUNTIME_CLASSES.has(c)) n.classList.remove(c);
      if (!n.getAttribute('class')) n.removeAttribute('class');
    }
    for (const ch of Array.from(n.children)) strip(ch);
  };
  strip(clone);
  const html = clone.outerHTML.replace(/\s+/g, ' ').trim();
  return html.length > 400 ? html.slice(0, 400) + '…' : html;
}

function describe(win: Window, el: Element): RegionElement {
  const cs = win.getComputedStyle(el);
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const isLeaf = el.children.length === 0;
  const head = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
  return {
    label: text ? `${head} · "${text.slice(0, 26)}${text.length > 26 ? '…' : ''}"` : head,
    html: cleanOuterHtml(el),
    color: isLeaf && text ? cs.color : undefined,
    bg: isOpaque(cs.backgroundColor) ? cs.backgroundColor : undefined,
  };
}

function gatherContext(doc: Document, rect: { left: number; top: number; width: number; height: number }): RegionContext {
  const win = doc.defaultView!;
  const section =
    doc.querySelector('.slides section.present') || doc.querySelector('.slides section');
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;

  let px = { x: 0, y: 0, w: 0, h: 0 };
  let pct = { left: 0, top: 0, right: 100, bottom: 100 };
  const sr = section?.getBoundingClientRect();
  if (sr && sr.width > 0 && sr.height > 0) {
    const L = clamp01((rect.left - sr.left) / sr.width);
    const R = clamp01((right - sr.left) / sr.width);
    const T = clamp01((rect.top - sr.top) / sr.height);
    const B = clamp01((bottom - sr.top) / sr.height);
    pct = { left: Math.round(L * 100), top: Math.round(T * 100), right: Math.round(R * 100), bottom: Math.round(B * 100) };
    px = { x: Math.round(L * SLIDE_W), y: Math.round(T * SLIDE_H), w: Math.round((R - L) * SLIDE_W), h: Math.round((B - T) * SLIDE_H) };
  }

  const elements: RegionElement[] = [];
  if (section) {
    const hits: Element[] = [];
    for (const el of Array.from(section.querySelectorAll('*'))) {
      if (SKIP.has(el.tagName) || el.classList.contains('autolink')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < right && r.right > rect.left && r.top < bottom && r.bottom > rect.top) hits.push(el);
    }
    // Keep only the deepest hits — drop any element that's an ancestor of another hit, so
    // the list is the actual content under the region, not every wrapping container.
    const leaves = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    for (const el of leaves.slice(0, 8)) elements.push(describe(win, el));
  }

  const center = backgroundUnder(doc, win, rect.left + rect.width / 2, rect.top + rect.height / 2);
  const areaColor = center ?? (section ? win.getComputedStyle(section).backgroundColor : null);

  return { px, pct, areaColor: isOpaque(areaColor) ? areaColor : null, elements };
}

/**
 * Wire Shift+Cmd marquee selection onto a preview iframe document. Dragging draws a
 * rectangle; on release `onComplete` receives the rect (iframe coords) + gathered context.
 * The rectangle stays drawn until clearRegionMarquee() is called.
 */
export function attachRegionPicker(doc: Document, onComplete: (r: RegionResult) => void): void {
  let dragging = false;
  let sx = 0;
  let sy = 0;

  doc.addEventListener(
    'mousedown',
    (e: MouseEvent) => {
      if (!(e.shiftKey && e.metaKey) || e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      setRegionCursor(doc, true);
      sx = e.clientX;
      sy = e.clientY;
      Object.assign(ensureMarquee(doc).style, { left: `${sx}px`, top: `${sy}px`, width: '0px', height: '0px' });
    },
    true,
  );
  doc.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      setRegionCursor(doc, dragging || (e.shiftKey && e.metaKey)); // crosshair hint
      if (!dragging) return;
      e.preventDefault();
      const r = rectOf(sx, sy, e.clientX, e.clientY);
      Object.assign(ensureMarquee(doc).style, {
        left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
    },
    true,
  );
  doc.addEventListener(
    'mouseup',
    (e: MouseEvent) => {
      if (!dragging) return;
      dragging = false;
      setRegionCursor(doc, false);
      const r = rectOf(sx, sy, e.clientX, e.clientY);
      if (r.width < 6 || r.height < 6) {
        clearRegionMarquee(doc);
        return;
      }
      e.preventDefault();
      onComplete({ anchor: r, context: gatherContext(doc, r) });
    },
    true,
  );
  doc.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dragging) {
      dragging = false;
      setRegionCursor(doc, false);
      clearRegionMarquee(doc);
    }
  });
  doc.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Meta') setRegionCursor(doc, dragging || (e.shiftKey && e.metaKey));
  });
}

/** Build the edit-agent prompt: the user's instruction plus an inline description of the
 *  selected region (so the agent can locate the target on the slide). */
export function composeRegionPrompt(userText: string, ctx: RegionContext): string {
  const w = ctx.pct.right - ctx.pct.left;
  const h = ctx.pct.bottom - ctx.pct.top;
  const lines: string[] = [
    'Context — selected region of the slide (the slide is 1280×720; use this only to locate the target):',
    `- Position: left ${ctx.pct.left}%, top ${ctx.pct.top}%, size ${w}%×${h}% (≈ x:${ctx.px.x} y:${ctx.px.y} w:${ctx.px.w} h:${ctx.px.h}px).`,
  ];
  if (ctx.areaColor) lines.push(`- Background color under the region: ${ctx.areaColor}.`);
  if (ctx.elements.length) {
    lines.push('- Elements in the region (current markup, with inline styles):');
    for (const e of ctx.elements) {
      const extras = [e.color ? `color ${e.color}` : '', e.bg ? `bg ${e.bg}` : '']
        .filter(Boolean)
        .join(', ');
      lines.push(`    • ${e.html}${extras ? `   (rendered ${extras})` : ''}`);
    }
  } else {
    lines.push('- No specific elements detected (likely empty background).');
  }
  return `${userText.trim()}\n\n${lines.join('\n')}`;
}
