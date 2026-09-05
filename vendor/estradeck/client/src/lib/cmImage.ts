import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';

/** An image the current deck/theme already has — offered in the swap picker. */
export interface ImageAsset {
  name: string;
  /** Absolute URL to display it (served by the studio). */
  url: string;
  /** What gets written into the editor: images/foo.png or assets/foo.png. */
  ref: string;
}

export interface ImageThumbsConfig {
  /** Resolve a `src`/`url(...)` value to a displayable URL for the inline thumbnail
   *  (synchronous). Return null if it can't be shown. */
  resolveUrl: (value: string) => string | null;
  /** Fetch the deck's / theme's images for the swap picker (async, on open). */
  listAssets: () => Promise<ImageAsset[]>;
}

// Image references in slide/template source: `src="…"`, `poster="…"`,
// `data-background-image="…"`, and CSS `url(…)`. We capture the attribute name (if any)
// and the value so we can tell an <img>/background from a <script src> or font url().
const ATTR_RE = /\b(src|poster|data-background-image)\s*=\s*("|')([^"']*)\2/gi;
// url(...) with a double-quoted, single-quoted (spaces ok), or bare (no spaces) value.
const URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/gi;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#]|$)/i;

/** Does this value point at an image? `poster`/`data-background-image` always do; for
 *  `src` and `url(...)` we require an image extension or a data:image URL so we don't
 *  decorate `<script src>`, video sources, or font `url()`s. */
function isImageValue(attr: string | null, value: string): boolean {
  if (!value) return false;
  if (/^data:image\//i.test(value)) return true;
  if (attr === 'poster' || attr === 'data-background-image') return true;
  return IMG_EXT_RE.test(value);
}

class ImageThumbWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(o: ImageThumbWidget) {
    return o.src === this.src;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-img-thumb';
    span.title = 'Swap image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = '';
    img.addEventListener('error', () => span.classList.add('cm-img-thumb-broken'));
    span.appendChild(img);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView, resolveUrl: (v: string) => string | null): DecorationSet {
  const deco: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    const add = (attr: string | null, value: string, valueStartInText: number) => {
      if (!isImageValue(attr, value)) return;
      const src = resolveUrl(value);
      if (!src) return;
      deco.push(
        Decoration.widget({ widget: new ImageThumbWidget(src), side: -1 }).range(
          from + valueStartInText,
        ),
      );
    };
    for (const m of text.matchAll(ATTR_RE)) {
      const valueStart = (m.index ?? 0) + m[0].indexOf(m[3], m[1].length);
      add(m[1].toLowerCase(), m[3], valueStart);
    }
    for (const m of text.matchAll(URL_RE)) {
      const value = m[1] ?? m[2] ?? m[3];
      if (value == null) continue;
      const valueStart = (m.index ?? 0) + m[0].indexOf(value);
      add(null, value, valueStart);
    }
  }
  // Decorations must be sorted by position; ATTR and URL passes can interleave.
  return Decoration.set(deco, true);
}

/** The value range the widget sits in front of — recomputed from the doc at click time
 *  (positions drift as the doc changes, exactly like the color-swatch picker). */
function valueRangeAt(view: EditorView, el: HTMLElement): { from: number; to: number } {
  const from = view.posAtDOM(el);
  const doc = view.state.doc;
  const prev = from > 0 ? doc.sliceString(from - 1, from) : '';
  const rest = doc.sliceString(from, Math.min(doc.length, from + 200000));
  let end: number;
  if (prev === '"' || prev === "'") {
    const i = rest.indexOf(prev); // quoted: value runs to the matching quote (spaces ok)
    end = i === -1 ? rest.length : i;
  } else {
    const m = /^[^)'"\s]*/.exec(rest); // url(...) unquoted: up to ) or whitespace
    end = m ? m[0].length : 0;
  }
  return { from, to: from + end };
}

/** Popup grid of the deck's / theme's images; clicking one rewrites the URL value. */
function openSwapPicker(view: EditorView, el: HTMLElement, cfg: ImageThumbsConfig) {
  const range = valueRangeAt(view, el);
  const replace = (ref: string) => {
    view.dispatch({ changes: { from: range.from, to: range.to, insert: ref } });
  };

  const pop = document.createElement('div');
  pop.className = 'cm-img-pop';
  Object.assign(pop.style, {
    position: 'fixed', zIndex: '1000', width: '264px', maxHeight: '320px', overflowY: 'auto',
    padding: '10px', background: '#1c1c2a', border: '1px solid #2a2a3c', borderRadius: '10px',
    boxShadow: '0 12px 34px rgba(0,0,0,0.5)', color: '#ececf4',
    font: '13px Inter, system-ui, sans-serif',
  });

  const heading = document.createElement('div');
  heading.textContent = 'Swap image';
  Object.assign(heading.style, {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em',
    color: '#9a9ab0', marginBottom: '8px',
  });
  pop.appendChild(heading);

  const status = document.createElement('div');
  status.textContent = 'Loading…';
  Object.assign(status.style, { color: '#9a9ab0', padding: '4px 0' });
  pop.appendChild(status);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px',
  });
  pop.appendChild(grid);

  const r = el.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 276))}px`;
  pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 340)}px`;
  document.body.appendChild(pop);

  function close() {
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
  }
  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node)) close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  cfg
    .listAssets()
    .then((assets) => {
      if (!pop.isConnected) return;
      if (!assets.length) {
        status.textContent = 'No images in this deck/theme yet.';
        return;
      }
      status.remove();
      for (const a of assets) {
        const b = document.createElement('button');
        b.className = 'cm-img-pick';
        b.title = a.name;
        Object.assign(b.style, {
          padding: '0', border: '1px solid #2a2a3c', borderRadius: '6px', overflow: 'hidden',
          background: '#11111a', cursor: 'pointer', aspectRatio: '1 / 1',
        });
        const img = document.createElement('img');
        img.src = a.url;
        img.alt = a.name;
        img.loading = 'lazy';
        Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
        b.appendChild(img);
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          replace(a.ref);
          close();
        });
        grid.appendChild(b);
      }
    })
    .catch(() => {
      if (pop.isConnected) status.textContent = 'Could not load images.';
    });

  // Defer so the opening click doesn't immediately dismiss the popup.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
}

/** Inline thumbnails before image `src` / `url(...)` values; click opens a picker of the
 *  deck's / theme's existing images to swap to. Mirrors the color-swatch extension. */
export function imageThumbs(cfg: ImageThumbsConfig) {
  const theme = EditorView.baseTheme({
    '.cm-img-thumb': {
      display: 'inline-block', width: '1.5em', height: '1.05em', marginRight: '0.35em',
      verticalAlign: '-0.18em', borderRadius: '3px', overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.3)', background: 'rgba(255,255,255,0.06)',
      cursor: 'pointer', boxSizing: 'border-box',
    },
    '.cm-img-thumb img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    '.cm-img-thumb-broken img': { display: 'none' },
    '.cm-img-thumb-broken': {
      backgroundImage:
        'linear-gradient(45deg,#444 25%,transparent 25%,transparent 75%,#444 75%),' +
        'linear-gradient(45deg,#444 25%,transparent 25%,transparent 75%,#444 75%)',
      backgroundSize: '6px 6px', backgroundPosition: '0 0, 3px 3px',
    },
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, cfg.resolveUrl);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = build(u.view, cfg.resolveUrl);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e, view) {
          const t = e.target as HTMLElement | null;
          const span = t?.closest('.cm-img-thumb') as HTMLElement | null;
          if (span) {
            e.preventDefault();
            openSwapPicker(view, span, cfg);
          }
        },
      },
    },
  );

  return [theme, plugin];
}
