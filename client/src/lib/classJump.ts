import { syntaxTree } from '@codemirror/language';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';

/**
 * If `pos` falls inside a `class="…"` attribute value, return the single class token
 * under the cursor (the whitespace-delimited word containing pos) with its absolute
 * document range. Returns null when the position isn't inside a class value or sits
 * on whitespace.
 */
export function classTokenAt(
  view: EditorView,
  pos: number,
): { name: string; from: number; to: number } | null {
  const tree = syntaxTree(view.state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let av: any = tree.resolveInner(pos, -1);
  while (av && av.name !== 'AttributeValue') av = av.parent;
  if (!av) return null;

  const nameNode = av.parent?.getChild ? av.parent.getChild('AttributeName') : null;
  const attrName = nameNode ? view.state.sliceDoc(nameNode.from, nameNode.to) : '';
  if (attrName !== 'class') return null;

  // Trim the surrounding quotes off the value range, if present.
  const opensQuote = /["']/.test(view.state.sliceDoc(av.from, av.from + 1));
  const closesQuote = /["']/.test(view.state.sliceDoc(av.to - 1, av.to));
  const valFrom = opensQuote ? av.from + 1 : av.from;
  const valTo = closesQuote ? av.to - 1 : av.to;
  if (pos < valFrom || pos > valTo) return null;

  const value = view.state.sliceDoc(valFrom, valTo);
  const offset = pos - valFrom;
  let start = offset;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  let end = offset;
  while (end < value.length && !/\s/.test(value[end])) end++;
  const name = value.slice(start, end).trim();
  if (!name) return null;
  return { name, from: valFrom + start, to: valFrom + end };
}

/**
 * Locate the first occurrence of a class selector (`.name`) in CSS source. Matches
 * the whole class token so `.lead` never matches `.lead-in`. Returns the range of
 * the matched selector text, or null when the class isn't defined.
 */
export function findClassRule(
  css: string,
  className: string,
): { from: number; to: number } | null {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w-])\\.${esc}(?![\\w-])`);
  const m = re.exec(css);
  if (!m || m.index < 0) return null;
  return { from: m.index, to: m.index + m[0].length };
}

// --- ⌘/Ctrl-hover affordance: underline + pointer over a jumpable class ----------

const setLinkRange = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: 'cm-class-link' });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLinkRange)) {
        deco = e.value ? Decoration.set([linkMark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * While Cmd/Ctrl is held, mark the class token under the pointer as a clickable link
 * (underline + pointer cursor) when it's a class defined in the deck's styles.css —
 * signalling that a click will jump to its rule. `getClasses` returns the known deck
 * classes (loaded for autocompletion).
 */
export function classLinkHighlighter(getClasses: () => string[]): Extension {
  let active: { from: number; to: number } | null = null;
  let lastX = 0;
  let lastY = 0;
  let haveCoords = false;

  const apply = (view: EditorView, range: { from: number; to: number } | null) => {
    const same =
      (!active && !range) || (!!active && !!range && active.from === range.from && active.to === range.to);
    if (same) return;
    active = range;
    view.dispatch({ effects: setLinkRange.of(range) });
  };

  const evalAt = (view: EditorView, x: number, y: number, mod: boolean) => {
    if (!mod) return apply(view, null);
    const pos = view.posAtCoords({ x, y });
    if (pos == null) return apply(view, null);
    const tok = classTokenAt(view, pos);
    if (!tok || !getClasses().includes(tok.name)) return apply(view, null);
    apply(view, { from: tok.from, to: tok.to });
  };

  return [
    linkField,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        lastX = event.clientX;
        lastY = event.clientY;
        haveCoords = true;
        evalAt(view, event.clientX, event.clientY, event.metaKey || event.ctrlKey);
      },
      mouseleave(_event, view) {
        apply(view, null);
      },
      // Pressing Cmd/Ctrl while already hovering should light up the link immediately.
      keydown(event, view) {
        if ((event.key === 'Meta' || event.key === 'Control') && haveCoords) {
          evalAt(view, lastX, lastY, true);
        }
      },
      keyup(event, view) {
        if (!event.metaKey && !event.ctrlKey) apply(view, null);
      },
    }),
  ];
}
