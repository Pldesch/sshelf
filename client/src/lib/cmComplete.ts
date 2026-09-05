import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { CssVar } from '@studio/shared';
import { TRANSITIONS, TRANSITION_SPEEDS, FRAGMENT_EFFECTS } from '@studio/shared';

/** Brand/deck data the completion source reads (loaded per deck, read live). */
export interface CompletionData {
  classes: string[];
  cssVars: CssVar[];
}

// --- curated CSS vocabulary for slide authoring ---
const CSS_PROPERTIES = [
  'align-content', 'align-items', 'background', 'background-color', 'background-image', 'border',
  'border-radius', 'box-shadow', 'color', 'column-gap', 'display', 'flex', 'flex-direction',
  'flex-wrap', 'font-family', 'font-size', 'font-weight', 'gap', 'grid-template-columns',
  'grid-template-rows', 'height', 'justify-content', 'justify-items', 'letter-spacing', 'line-height',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'max-height', 'max-width',
  'min-height', 'min-width', 'object-fit', 'opacity', 'overflow', 'padding', 'padding-top',
  'padding-bottom', 'padding-left', 'padding-right', 'position', 'text-align', 'text-transform',
  'top', 'right', 'bottom', 'left', 'transform', 'transition', 'white-space', 'width', 'z-index',
];

const VALUE_MAP: Record<string, string[]> = {
  display: ['flex', 'grid', 'block', 'inline-block', 'inline-flex', 'none'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  'justify-items': ['start', 'center', 'end', 'stretch'],
  'align-items': ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  'align-content': ['flex-start', 'center', 'flex-end', 'space-between', 'stretch'],
  'text-align': ['left', 'center', 'right', 'justify'],
  position: ['relative', 'absolute', 'fixed', 'sticky', 'static'],
  overflow: ['hidden', 'auto', 'visible', 'scroll'],
  'white-space': ['nowrap', 'normal', 'pre', 'pre-wrap'],
  'object-fit': ['cover', 'contain', 'fill', 'none', 'scale-down'],
  'font-weight': ['300', '400', '500', '600', '700', 'bold', 'normal'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
};

const COLOR_PROPS = new Set(['color', 'background', 'background-color', 'border-color', 'fill', 'stroke']);
const GLOBAL_VALUES = ['inherit', 'initial', 'unset'];
const NAMED_COLORS = ['transparent', 'currentColor', '#ffffff', '#000000'];

const REVEAL_DATA_ATTRS = [
  'data-background-color', 'data-background-image', 'data-background-gradient', 'data-transition',
  'data-transition-speed', 'data-auto-animate', 'data-fragment-index', 'data-state',
];

// reveal.js / structural classes that aren't useful to suggest on a slide element
const REVEAL_INTERNAL = new Set([
  'reveal', 'slides', 'slide-background', 'backgrounds', 'controls', 'progress', 'present', 'past',
  'future', 'visible', 'current-fragment', 'stack', 'enabled', 'overlay', 'print-pdf', 'reveal-viewport',
  'has-light-background', 'has-dark-background',
]);

/** Pull class names out of a deck's styles.css (selectors like `.tweet-card`). */
export function extractDeckClasses(css: string): string[] {
  const set = new Set<string>();
  const re = /\.(-?[_a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (!REVEAL_INTERNAL.has(m[1])) set.add(m[1]);
  }
  return [...set].sort();
}

function tokenStart(ctx: CompletionContext, valStart: number, charClass: RegExp): number {
  const text = ctx.state.sliceDoc(valStart, ctx.pos);
  const m = charClass.exec(text);
  return ctx.pos - (m ? m[0].length : 0);
}

const WORD = /[\w-]*$/;
const CSS_TOKEN = /[\w#().%-]*$/;

function listResult(ctx: CompletionContext, valStart: number, options: Completion[]): CompletionResult {
  return { from: tokenStart(ctx, valStart, WORD), options, validFor: WORD };
}

function valueOptions(prop: string, data: CompletionData): Completion[] {
  const out: Completion[] = [];
  (VALUE_MAP[prop] ?? []).forEach((v) => out.push({ label: v, type: 'enum' }));
  const isColor = COLOR_PROPS.has(prop);
  for (const v of data.cssVars) {
    out.push({ label: `var(${v.name})`, type: 'variable', detail: v.value, boost: isColor && v.kind === 'color' ? 2 : 0 });
  }
  if (isColor) NAMED_COLORS.forEach((c) => out.push({ label: c, type: 'color' }));
  GLOBAL_VALUES.forEach((v) => out.push({ label: v, type: 'keyword' }));
  return out;
}

function completeStyle(ctx: CompletionContext, valStart: number, data: CompletionData): CompletionResult {
  const text = ctx.state.sliceDoc(valStart, ctx.pos);
  const decl = text.slice(text.lastIndexOf(';') + 1); // current declaration
  const colon = decl.indexOf(':');
  if (colon < 0) {
    // typing a property name
    const options = CSS_PROPERTIES.map((p) => ({ label: p, type: 'property', apply: `${p}: ` }) as Completion);
    return { from: tokenStart(ctx, valStart, WORD), options, validFor: WORD };
  }
  // typing a value
  const prop = decl.slice(0, colon).trim().toLowerCase();
  return { from: tokenStart(ctx, valStart, CSS_TOKEN), options: valueOptions(prop, data), validFor: CSS_TOKEN };
}

function completeColorValue(ctx: CompletionContext, valStart: number, data: CompletionData): CompletionResult {
  const out: Completion[] = [];
  for (const v of data.cssVars.filter((x) => x.kind === 'color')) {
    out.push({ label: `var(${v.name})`, type: 'variable', detail: v.value });
    out.push({ label: v.value, type: 'color' });
  }
  NAMED_COLORS.forEach((c) => out.push({ label: c, type: 'color' }));
  return { from: tokenStart(ctx, valStart, CSS_TOKEN), options: out, validFor: CSS_TOKEN };
}

/**
 * A brand-aware completion source: deck classes in class="", CSS props/values + the
 * deck's CSS variables in style="", and reveal value/attribute names for data-*.
 * Registered as extra `autocomplete` language data, so it complements lang-html's
 * built-in tag/attribute completion rather than replacing it.
 */
export function makeBrandCompletionSource(getData: () => CompletionData) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const tree = syntaxTree(ctx.state);
    const node: { name: string; from: number; parent: unknown } = tree.resolveInner(ctx.pos, -1) as never;

    // Typing an attribute name → offer reveal data-* attributes (merges with lang-html).
    if (node.name === 'AttributeName') {
      return {
        from: node.from,
        options: REVEAL_DATA_ATTRS.map((a) => ({ label: a, type: 'property' })),
        validFor: WORD,
      };
    }

    // Inside an attribute value?
    let av: any = node;
    while (av && av.name !== 'AttributeValue') av = av.parent;
    if (!av) return null;
    const nameNode = av.parent?.getChild ? av.parent.getChild('AttributeName') : null;
    const attrName = nameNode ? ctx.state.sliceDoc(nameNode.from, nameNode.to) : '';
    const q = ctx.state.sliceDoc(av.from, av.from + 1);
    const valStart = q === '"' || q === "'" ? av.from + 1 : av.from;
    if (ctx.pos < valStart) return null;

    const data = getData();
    switch (attrName) {
      case 'class':
        return listResult(
          ctx,
          valStart,
          [...new Set([...data.classes, ...FRAGMENT_EFFECTS, 'fragment'])].map((c) => ({ label: c, type: 'class' })),
        );
      case 'style':
        return completeStyle(ctx, valStart, data);
      case 'data-transition':
        return listResult(ctx, valStart, (TRANSITIONS as readonly string[]).map((v) => ({ label: v, type: 'enum' })));
      case 'data-transition-speed':
        return listResult(ctx, valStart, (TRANSITION_SPEEDS as readonly string[]).map((v) => ({ label: v, type: 'enum' })));
      case 'data-background-color':
      case 'data-background-gradient':
        return completeColorValue(ctx, valStart, data);
      default:
        return null;
    }
  };
}
