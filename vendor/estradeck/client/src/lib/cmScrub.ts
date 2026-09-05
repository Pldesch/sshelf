import { Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// A CSS number, optionally with a unit. Scoped to style="" values, with colors and
// functions masked out first so we never scrub hex digits or rgb()/var() internals.
const UNIT =
  '(px|pt|em|rem|%|vh|vw|vmin|vmax|svh|dvh|ch|ex|fr|deg|rad|turn|s|ms|cm|mm|in|pc|q)';
const NUM_RE = new RegExp(`(^|[\\s:,(/])(-?(?:\\d+\\.?\\d*|\\.\\d+))${UNIT}?(?![\\w#.])`, 'gi');
const MASK_RE = /#[0-9a-fA-F]+|(?:rgba?|hsla?|var|url|calc|env)\([^)]*\)/gi;
const PIX_PER_STEP = 4; // horizontal pixels of drag per value step

interface Target {
  from: number; // start of the numeric part (replace target)
  numTo: number; // end of the numeric part
  dispTo: number; // end including the unit (hit area)
  value: number;
  decimals: number;
}

function scan(view: EditorView): { deco: DecorationSet; targets: Target[] } {
  const targets: Target[] = [];
  const marks: Range<Decoration>[] = [];
  const mark = Decoration.mark({ class: 'cm-scrub-num' });
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Attribute') return;
        const nameNode = node.node.getChild('AttributeName');
        if (!nameNode || view.state.sliceDoc(nameNode.from, nameNode.to) !== 'style') return;
        const valNode = node.node.getChild('AttributeValue');
        if (!valNode) return;
        const q = view.state.sliceDoc(valNode.from, valNode.from + 1);
        const quoted = q === '"' || q === "'";
        const base = quoted ? valNode.from + 1 : valNode.from;
        const end = quoted ? valNode.to - 1 : valNode.to;
        if (end <= base) return;
        const masked = view.state.sliceDoc(base, end).replace(MASK_RE, (m) => ' '.repeat(m.length));
        for (const m of masked.matchAll(NUM_RE)) {
          const numStr = m[2];
          const unit = m[3] ?? '';
          const numFrom = base + (m.index ?? 0) + m[1].length;
          const numTo = numFrom + numStr.length;
          const dispTo = numTo + unit.length;
          const dot = numStr.indexOf('.');
          targets.push({
            from: numFrom,
            numTo,
            dispTo,
            value: parseFloat(numStr),
            decimals: dot < 0 ? 0 : numStr.length - dot - 1,
          });
          marks.push(mark.range(numFrom, dispTo));
        }
      },
    });
  }
  return { deco: Decoration.set(marks, true), targets };
}

/** Alt-drag a numeric value in a style="" attribute to scrub it up/down (Shift = ×10). */
export function numberScrubber() {
  const theme = EditorView.baseTheme({
    '&.cm-scrub-alt .cm-scrub-num': {
      cursor: 'ew-resize',
      textDecoration: 'underline dotted',
      textDecorationColor: 'rgba(130, 170, 255, 0.8)',
      textUnderlineOffset: '2px',
    },
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      targets: Target[];
      drag:
        | { from: number; value: number; decimals: number; startX: number; lastText: string; origText: string }
        | null = null;

      constructor(readonly view: EditorView) {
        const r = scan(view);
        this.decorations = r.deco;
        this.targets = r.targets;
        this.onDown = this.onDown.bind(this);
        this.onMove = this.onMove.bind(this);
        this.onUp = this.onUp.bind(this);
        this.onKey = this.onKey.bind(this);
        view.dom.addEventListener('mousedown', this.onDown, true);
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('keyup', this.onKey);
        window.addEventListener('blur', this.onKey);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          const r = scan(u.view);
          this.decorations = r.deco;
          this.targets = r.targets;
        }
      }

      destroy() {
        this.view.dom.removeEventListener('mousedown', this.onDown, true);
        window.removeEventListener('keydown', this.onKey);
        window.removeEventListener('keyup', this.onKey);
        window.removeEventListener('blur', this.onKey);
        this.endDrag();
      }

      onKey(e: KeyboardEvent | FocusEvent) {
        if (this.drag && 'key' in e && e.key === 'Escape') {
          e.preventDefault();
          this.cancelDrag();
          return;
        }
        const alt = 'altKey' in e ? e.altKey : false;
        this.view.dom.classList.toggle('cm-scrub-alt', alt);
      }

      onDown(e: MouseEvent) {
        if (!e.altKey || e.button !== 0) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return;
        const t = this.targets.find((x) => pos >= x.from && pos <= x.dispTo);
        if (!t) return;
        e.preventDefault();
        e.stopPropagation(); // beat CodeMirror's Alt rectangular-selection
        const origText = this.view.state.sliceDoc(t.from, t.numTo);
        this.drag = {
          from: t.from,
          value: t.value,
          decimals: t.decimals,
          startX: e.clientX,
          lastText: origText,
          origText,
        };
        document.addEventListener('mousemove', this.onMove);
        document.addEventListener('mouseup', this.onUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
      }

      onMove(e: MouseEvent) {
        const d = this.drag;
        if (!d) return;
        const step = (d.decimals > 0 ? Math.pow(10, -d.decimals) : 1) * (e.shiftKey ? 10 : 1);
        const steps = Math.round((e.clientX - d.startX) / PIX_PER_STEP);
        const val = d.value + steps * step;
        const text = d.decimals > 0 ? val.toFixed(d.decimals) : String(Math.round(val));
        if (text === d.lastText) return;
        this.view.dispatch({
          changes: { from: d.from, to: d.from + d.lastText.length, insert: text },
          scrollIntoView: false,
        });
        d.lastText = text;
      }

      onUp() {
        this.endDrag();
      }

      cancelDrag() {
        const d = this.drag;
        if (!d) return;
        if (d.lastText !== d.origText) {
          this.view.dispatch({
            changes: { from: d.from, to: d.from + d.lastText.length, insert: d.origText },
            scrollIntoView: false,
          });
        }
        this.endDrag();
      }

      endDrag() {
        if (!this.drag) return;
        this.drag = null;
        document.removeEventListener('mousemove', this.onMove);
        document.removeEventListener('mouseup', this.onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [theme, plugin];
}
