import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

/**
 * Given a document position, return the element-child index path from the slide's
 * root <section> down to the HTML element under the cursor, plus that element's
 * source start offset. Returns null when the position is not inside an element.
 */
export function elementPathAt(
  view: EditorView,
  pos: number,
): { path: number[]; from: number } | null {
  const tree = syntaxTree(view.state);
  let node: any = tree.resolveInner(pos, -1);
  while (node && node.name !== 'Element') node = node.parent;
  if (!node) return null;

  // Chain of Element ancestors: [section, …, hovered].
  const chain: any[] = [];
  let cur: any = node;
  while (cur && cur.name === 'Element') {
    chain.unshift(cur);
    let p = cur.parent;
    while (p && p.name !== 'Element') p = p.parent;
    cur = p;
  }

  const path: number[] = [];
  for (let i = 1; i < chain.length; i++) {
    let idx = 0;
    let sib = chain[i].prevSibling;
    while (sib) {
      if (sib.name === 'Element') idx++;
      sib = sib.prevSibling;
    }
    path.push(idx);
  }
  return { path, from: node.from };
}

/**
 * Inverse of {@link elementPathAt}: given an element-child index path from the slide's
 * root <section>, return that element's source start offset (for moving the cursor),
 * or null if the path doesn't resolve. Used to jump from a clicked preview element to
 * its source in the slide editor.
 */
export function offsetForPath(view: EditorView, path: number[]): number | null {
  const tree = syntaxTree(view.state);

  // The slide's root <section> is the first top-level Element node.
  let node: any = tree.topNode.firstChild;
  while (node && node.name !== 'Element') node = node.nextSibling;
  if (!node) return null;

  for (const idx of path) {
    let i = 0;
    let child: any = node.firstChild;
    let found: any = null;
    while (child) {
      if (child.name === 'Element') {
        if (i === idx) {
          found = child;
          break;
        }
        i++;
      }
      child = child.nextSibling;
    }
    if (!found) return null;
    node = found;
  }
  // Land the cursor just *inside* the element — right after the opening tag's '>' — so
  // it's ready to edit the content, not before the '<'. Falls back to the element start.
  const open: any = node.firstChild;
  if (open && (open.name === 'OpenTag' || open.name === 'SelfClosingTag')) return open.to;
  return node.from;
}
