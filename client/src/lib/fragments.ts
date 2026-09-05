/**
 * Count reveal.js fragment animation steps in a slide's raw HTML.
 *
 * Mirrors reveal's own step counting: fragments that share a `data-fragment-index`
 * reveal together (one step per distinct index), and every fragment without an
 * explicit index becomes its own step. e.g. two indexed fragments → 2 steps; ten
 * un-indexed fragments → 10 steps.
 */
export function fragmentSteps(rawHtml: string): number {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const frags = Array.from(doc.querySelectorAll('.fragment'));
  if (frags.length === 0) return 0;
  const explicit = new Set<number>();
  let unordered = 0;
  for (const f of frags) {
    const raw = f.getAttribute('data-fragment-index');
    const idx = raw == null ? NaN : Number(raw);
    if (Number.isFinite(idx)) explicit.add(idx);
    else unordered += 1;
  }
  return explicit.size + unordered;
}
