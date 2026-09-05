/**
 * Normalize a user-entered URL: trim it and assume https:// when no scheme is given, so
 * "example.com/x" and "//example.com/x" both become "https://example.com/x". URLs that
 * already carry a scheme (http:, https:, …) are left untouched.
 */
export function normalizeUrl(input: string | undefined | null): string {
  const s = (input ?? '').trim();
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s; // already has scheme://
  if (s.startsWith('//')) return `https:${s}`; // protocol-relative
  return `https://${s}`;
}
