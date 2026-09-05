import { parse } from 'parse5';
import { HttpError } from './errors';
import { normalizeUrl } from './url';

/** Minimal parse5 node shape for walking the tree. */
interface P5Node {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
}

function addFromSrcset(srcset: string | undefined, add: (raw?: string) => void): void {
  if (!srcset) return;
  for (const part of srcset.split(',')) {
    add(part.trim().split(/\s+/)[0]); // "url 2x" / "url 640w" → url
  }
}

/**
 * Fetch a web page and return the absolute URLs of the images it references — from
 * <img> (src / data-src / srcset), <source srcset>, <meta og:image / twitter:image>,
 * and <link rel="image_src">. data: URIs and non-http(s) refs are skipped. Pixel sizes
 * are read on the client (it loads each <img> for the preview anyway).
 */
export async function scrapeImages(input: string): Promise<string[]> {
  const pageUrl = normalizeUrl(input);
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new HttpError(400, 'Provide a website URL', 'INVALID_URL');
  }
  let res: Response;
  try {
    res = await fetch(pageUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Estradeck image picker)',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
  } catch (e) {
    throw new HttpError(400, `Could not fetch the page: ${(e as Error).message}`, 'FETCH_FAILED');
  }
  if (!res.ok) throw new HttpError(400, `Fetch failed: HTTP ${res.status}`, 'FETCH_FAILED');

  const base = res.url || pageUrl;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.startsWith('image/')) return [base]; // the URL is itself an image
  if (!ct.includes('html') && !ct.includes('xml')) {
    throw new HttpError(400, `That URL is not a web page (content-type: ${ct || 'unknown'})`, 'NOT_HTML');
  }

  const html = (await res.text()).slice(0, 4_000_000); // cap at ~4 MB of HTML
  const urls = new Set<string>();
  const add = (raw?: string) => {
    const v = raw?.trim();
    if (!v || v.startsWith('data:')) return;
    try {
      const abs = new URL(v, base).href;
      if (/^https?:/i.test(abs)) urls.add(abs);
    } catch {
      /* unparseable ref */
    }
  };

  const walk = (node: P5Node) => {
    const tag = node.tagName;
    if (tag) {
      const a = Object.fromEntries((node.attrs ?? []).map((x) => [x.name.toLowerCase(), x.value]));
      if (tag === 'img') {
        add(a.src);
        add(a['data-src']);
        add(a['data-original']);
        add(a['data-lazy-src']);
        addFromSrcset(a.srcset, add);
        addFromSrcset(a['data-srcset'], add);
      } else if (tag === 'source') {
        addFromSrcset(a.srcset, add);
        add(a.src);
      } else if (tag === 'meta' && (a.property === 'og:image' || a.name === 'twitter:image')) {
        add(a.content);
      } else if (tag === 'link' && /(^|\s)(image_src|apple-touch-icon)(\s|$)/i.test(a.rel ?? '')) {
        add(a.href);
      }
    }
    for (const c of node.childNodes ?? []) walk(c);
  };
  walk(parse(html) as unknown as P5Node);

  return [...urls].slice(0, 120);
}
