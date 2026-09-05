import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import type { CssVar } from '@studio/shared';

/** Dispatch this once the deck's CSS variables have loaded, to draw var(--brand) swatches. */
export const refreshSwatches = StateEffect.define<null>();

// Color tokens in slide HTML: hex, rgb()/rgba(), hsl()/hsla(), and var(--brand).
const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(\s*--[\w-]+\s*\)/g;
const TOKEN_RE =
  /^(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(\s*--[\w-]+\s*\))/;

let _ctx: CanvasRenderingContext2D | null = null;
function canvas(): CanvasRenderingContext2D {
  return (_ctx ??= document.createElement('canvas').getContext('2d')!);
}
/** Resolve any CSS color string to `#rrggbb`, or null if it isn't a valid color. */
function toHex(color: string): string | null {
  const c = canvas();
  c.fillStyle = '#ff7f00';
  c.fillStyle = color;
  const a = c.fillStyle;
  c.fillStyle = '#0080ff';
  c.fillStyle = color;
  const b = c.fillStyle;
  if (a !== b) return null; // invalid color: fillStyle stayed at the (differing) sentinels
  if (/^#[0-9a-f]{6}$/i.test(a)) return a.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(a);
  if (m) return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return null;
}

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(o: SwatchWidget) {
    return o.color === this.color;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-color-swatch';
    s.style.backgroundColor = this.color;
    s.title = `${this.color} — pick a color`;
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

function varsMap(vars: CssVar[]): Map<string, string> {
  return new Map(vars.map((v) => [v.name, v.value]));
}

function build(view: EditorView, vars: Map<string, string>): DecorationSet {
  const deco: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(COLOR_RE)) {
      const tok = m[0];
      let color: string | null = null;
      if (tok[0] === 'v') {
        const name = /--[\w-]+/.exec(tok)?.[0];
        const val = name ? vars.get(name) : undefined;
        if (val && toHex(val)) color = val;
      } else if (toHex(tok)) {
        color = tok;
      }
      if (!color) continue;
      deco.push(
        Decoration.widget({ widget: new SwatchWidget(color), side: -1 }).range(from + (m.index ?? 0)),
      );
    }
  }
  return Decoration.set(deco, true);
}

/** A small popup: pick a brand-palette color (inserts `var(--name)`) or a custom one (hex). */
function openPalette(view: EditorView, el: HTMLElement, getCssVars: () => CssVar[]) {
  const pos = view.posAtDOM(el);
  const m = TOKEN_RE.exec(view.state.sliceDoc(pos, Math.min(view.state.doc.length, pos + 64)));
  if (!m) return;
  let len = m[0].length;
  const replace = (insert: string) => {
    view.dispatch({ changes: { from: pos, to: pos + len, insert } });
    len = insert.length;
  };

  const pop = document.createElement('div');
  Object.assign(pop.style, {
    position: 'fixed', zIndex: '1000', width: '190px', padding: '8px',
    background: '#1c1c2a', border: '1px solid #2a2a3c', borderRadius: '10px',
    boxShadow: '0 12px 34px rgba(0,0,0,0.5)', color: '#ececf4',
    font: '13px Inter, system-ui, sans-serif',
  });

  const heading = document.createElement('div');
  heading.textContent = 'Brand palette';
  Object.assign(heading.style, {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em',
    color: '#9a9ab0', marginBottom: '6px',
  });
  pop.appendChild(heading);

  const grid = document.createElement('div');
  Object.assign(grid.style, { display: 'flex', flexWrap: 'wrap', gap: '5px' });
  for (const v of getCssVars().filter((x) => x.kind === 'color')) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      width: '22px', height: '22px', padding: '0', borderRadius: '5px',
      border: '1px solid rgba(255,255,255,0.25)', background: v.value, cursor: 'pointer',
    });
    b.title = `${v.name} · ${v.value}`;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      replace(`var(${v.name})`);
      close();
    });
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const hr = document.createElement('div');
  Object.assign(hr.style, { height: '1px', background: '#2a2a3c', margin: '9px 0' });
  pop.appendChild(hr);

  const custom = document.createElement('label');
  Object.assign(custom.style, { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' });
  const input = document.createElement('input');
  input.type = 'color';
  input.value = toHex(m[0]) ?? '#000000';
  Object.assign(input.style, { width: '30px', height: '24px', padding: '0', border: '0', background: 'none', cursor: 'pointer' });
  input.addEventListener('input', () => replace(input.value));
  const clabel = document.createElement('span');
  clabel.textContent = 'Custom colour…';
  custom.append(input, clabel);
  pop.appendChild(custom);

  const r = el.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 200))}px`;
  pop.style.top = `${r.bottom + 4}px`;
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
  // Defer so the opening click doesn't immediately dismiss the popup.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
}

/** Inline color swatches for hex/rgb/hsl/var(--brand) colors; click opens the palette picker. */
export function colorSwatches(getCssVars: () => CssVar[]) {
  const theme = EditorView.baseTheme({
    '.cm-color-swatch': {
      display: 'inline-block',
      width: '0.85em',
      height: '0.85em',
      borderRadius: '3px',
      marginRight: '0.3em',
      verticalAlign: '-0.08em',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      cursor: 'pointer',
      boxSizing: 'border-box',
    },
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, varsMap(getCssVars()));
      }
      update(u: ViewUpdate) {
        const refresh = u.transactions.some((t) => t.effects.some((e) => e.is(refreshSwatches)));
        if (u.docChanged || u.viewportChanged || refresh) {
          this.decorations = build(u.view, varsMap(getCssVars()));
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e, view) {
          const t = e.target as HTMLElement | null;
          if (t && t.classList.contains('cm-color-swatch')) {
            e.preventDefault();
            openPalette(view, t, getCssVars);
          }
        },
      },
    },
  );

  return [theme, plugin];
}
