const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

export function studioUrl(path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return path;
  return `${BASE_PATH}/${path.replace(/^\//, '')}`;
}
