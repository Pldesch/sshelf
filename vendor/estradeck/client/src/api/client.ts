import type {
  CssVar,
  DeckConfig,
  DeckModel,
  DeckSummary,
  DeckThemeState,
  FragmentElement,
  ImageInfo,
  Job,
  JobKind,
  Slide,
  Snapshot,
  Theme,
  ThemeAsset,
  ThemePlaceholder,
  ThemeSlideTemplate,
  ThemeSummary,
  ThemeVar,
  VideoInfo,
} from '@studio/shared';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let body: { error?: string; code?: string } | undefined;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// --- Decks ---
export const listDecks = () => request<DeckSummary[]>('/api/decks');
export const getDeck = (id: string) => request<DeckModel>(`/api/decks/${id}`);
export const getDeckConfig = (id: string) => request<DeckConfig>(`/api/decks/${id}/config`);
export const patchDeckConfig = (id: string, changes: Partial<DeckConfig>) =>
  request<DeckConfig>(`/api/decks/${id}/config`, jsonBody('PATCH', changes));
export const createDeck = (title: string) =>
  request<{ id: string }>('/api/decks', jsonBody('POST', { title }));
export const duplicateDeck = (id: string, title?: string) =>
  request<{ id: string }>(`/api/decks/${id}/duplicate`, jsonBody('POST', { title }));
export const deleteDeck = (id: string) => request<void>(`/api/decks/${id}`, { method: 'DELETE' });

// --- Slides ---
const slideUrl = (id: string, key: string) =>
  `/api/decks/${id}/slides/${encodeURIComponent(key)}`;

export const getSlide = (id: string, key: string) =>
  request<{ slide: Slide; contentHash: string }>(slideUrl(id, key));
export const putSlide = (id: string, key: string, rawHtml: string, expectedHash?: string) =>
  request<{ contentHash: string }>(slideUrl(id, key), jsonBody('PUT', { rawHtml, expectedHash }));
export const addSlide = (
  id: string,
  afterKey: string | null,
  expectedHash?: string,
  rawHtml?: string,
) => request<{ contentHash: string }>(`/api/decks/${id}/slides`, jsonBody('POST', { afterKey, expectedHash, rawHtml }));
export const deleteSlide = (id: string, key: string, expectedHash?: string) =>
  request<{ contentHash: string }>(
    `${slideUrl(id, key)}?expectedHash=${encodeURIComponent(expectedHash ?? '')}`,
    { method: 'DELETE' },
  );
export const duplicateSlide = (id: string, key: string, expectedHash?: string) =>
  request<{ contentHash: string; newKey: string }>(
    `${slideUrl(id, key)}/duplicate`,
    jsonBody('POST', { expectedHash }),
  );
// Copy a slide (with its images/videos) from one deck into another.
export const copySlideToDeck = (sourceId: string, key: string, targetDeckId: string) =>
  request<{ contentHash: string; newKey: string; copiedAssets: string[] }>(
    `${slideUrl(sourceId, key)}/copy-to`,
    jsonBody('POST', { targetDeckId }),
  );
export const reorderSlides = (id: string, order: string[], expectedHash?: string) =>
  request<{ contentHash: string }>(
    `/api/decks/${id}/slides/reorder`,
    jsonBody('POST', { order, expectedHash }),
  );

// --- Section attributes (transitions / background / auto-animate) ---
export const patchSection = (
  id: string,
  key: string,
  attrs: Record<string, string | boolean | null>,
  expectedHash?: string,
) =>
  request<{ contentHash: string }>(
    `${slideUrl(id, key)}/section`,
    jsonBody('PATCH', { attrs, expectedHash }),
  );

// --- Fragments ---
export const getFragments = (id: string, key: string) =>
  request<{ elements: FragmentElement[]; contentHash: string }>(`${slideUrl(id, key)}/fragments`);
export const patchFragment = (
  id: string,
  key: string,
  elementIndex: number,
  body: { fragment: boolean; effect: string; fragmentIndex: number | null },
  expectedHash?: string,
) =>
  request<{ contentHash: string }>(
    `${slideUrl(id, key)}/fragment`,
    jsonBody('PATCH', { elementIndex, ...body, expectedHash }),
  );

// --- History (version snapshots) ---
export const listHistory = (id: string) =>
  request<{ snapshots: Snapshot[] }>(`/api/decks/${id}/history`);
export const restoreSnapshot = (id: string, snapId: string) =>
  request<{ contentHash: string }>(`/api/decks/${id}/history/${snapId}/restore`, { method: 'POST' });

// --- Images ---
export const listImages = (id: string) =>
  request<{ images: ImageInfo[] }>(`/api/decks/${id}/images`);
export const uploadImage = (id: string, file: File | Blob, name: string) =>
  request<ImageInfo>(`/api/decks/${id}/images?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
export const addImageFromUrl = (id: string, url: string) =>
  request<ImageInfo>(`/api/decks/${id}/images/from-url`, jsonBody('POST', { url }));
export const deleteImage = (id: string, name: string) =>
  request<void>(`/api/decks/${id}/images/${encodeURIComponent(name)}`, { method: 'DELETE' });

// --- Videos (downloaded from YouTube et al. into the deck's videos/ folder) ---
export const listVideos = (id: string) =>
  request<{ videos: VideoInfo[] }>(`/api/decks/${id}/videos`);
export const downloadVideo = (id: string, url: string) =>
  request<VideoInfo>(`/api/decks/${id}/videos/from-url`, jsonBody('POST', { url }));
export const deleteVideo = (id: string, name: string) =>
  request<void>(`/api/decks/${id}/videos/${encodeURIComponent(name)}`, { method: 'DELETE' });

// --- Styles (CSS variables) ---
export const getStyles = (id: string) => request<CssVar[]>(`/api/decks/${id}/styles`);
export const putStyles = (id: string, changes: { name: string; value: string }[]) =>
  request<{ ok: true }>(`/api/decks/${id}/styles`, jsonBody('PUT', { changes }));

// --- Raw styles.css (full stylesheet, edited in the Styles tab) ---
export const getStylesRaw = (id: string) =>
  request<{ css: string; contentHash: string }>(`/api/decks/${id}/styles/raw`);
export const putStylesRaw = (id: string, css: string, expectedHash?: string) =>
  request<{ contentHash: string }>(
    `/api/decks/${id}/styles/raw`,
    jsonBody('PUT', { css, expectedHash }),
  );

// --- Themes ---
export const listThemes = () => request<ThemeSummary[]>('/api/themes');
export const getTheme = (themeId: string) => request<Theme>(`/api/themes/${themeId}`);
export const createTheme = (body: { name: string; description?: string; fromDeck?: string }) =>
  request<{ id: string }>('/api/themes', jsonBody('POST', body));
export const patchTheme = (
  themeId: string,
  patch: { name?: string; description?: string; fontImport?: string | null; vars?: ThemeVar[] },
) => request<Theme>(`/api/themes/${themeId}`, jsonBody('PATCH', patch));
export const deleteTheme = (themeId: string) =>
  request<void>(`/api/themes/${themeId}`, { method: 'DELETE' });
export const syncDecksUsingTheme = (themeId: string) =>
  request<{ synced: string[] }>(`/api/themes/${themeId}/sync-decks`, jsonBody('POST', {}));

export const getDeckTheme = (id: string) => request<DeckThemeState>(`/api/decks/${id}/theme`);
export const setDeckTheme = (id: string, themeId: string) =>
  request<DeckThemeState>(`/api/decks/${id}/theme`, jsonBody('PUT', { themeId }));
export const syncDeckTheme = (id: string) =>
  request<DeckThemeState>(`/api/decks/${id}/theme/sync`, jsonBody('POST', {}));

// --- Theme standard slides (templates with {{placeholders}}) ---
export const getThemeSlide = (themeId: string, slug: string) =>
  request<ThemeSlideTemplate>(`/api/themes/${themeId}/slides/${slug}`);
export const putThemeSlide = (
  themeId: string,
  slug: string,
  body: { name?: string; html: string; placeholders?: ThemePlaceholder[] },
) => request<ThemeSlideTemplate>(`/api/themes/${themeId}/slides/${slug}`, jsonBody('PUT', body));
export const deleteThemeSlide = (themeId: string, slug: string) =>
  request<void>(`/api/themes/${themeId}/slides/${slug}`, { method: 'DELETE' });
export const createThemeSlideFromDeck = (
  themeId: string,
  body: { deckId: string; slideKey: string; name?: string },
) =>
  request<{ slug: string; copiedAssets: string[] }>(
    `/api/themes/${themeId}/slides/from-deck`,
    jsonBody('POST', body),
  );

/** URL for the live-preview iframe of a theme slide rendered with the given values. */
export const themeSlidePreviewUrl = (themeId: string, slug: string, values: Record<string, string>) =>
  `/api/themes/${themeId}/slides/${slug}/preview?values=${encodeURIComponent(JSON.stringify(values))}`;

// --- Theme assets (images + videos in the theme's assets/ folder) ---
export const listThemeAssets = (themeId: string) =>
  request<{ assets: ThemeAsset[] }>(`/api/themes/${themeId}/assets`);
export const uploadThemeImage = (themeId: string, file: File | Blob, name: string) =>
  request<ThemeAsset>(`/api/themes/${themeId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
export const addThemeImageFromUrl = (themeId: string, url: string) =>
  request<ThemeAsset>(`/api/themes/${themeId}/assets/from-url`, jsonBody('POST', { url }));
export const downloadThemeVideo = (themeId: string, url: string) =>
  request<ThemeAsset>(`/api/themes/${themeId}/assets/video-from-url`, jsonBody('POST', { url }));
export const deleteThemeAsset = (themeId: string, name: string) =>
  request<void>(`/api/themes/${themeId}/assets/${encodeURIComponent(name)}`, { method: 'DELETE' });

/** Insert a theme slide (rendered with values) into a deck. */
export const insertThemeSlide = (
  deckId: string,
  body: { themeId: string; slug: string; values: Record<string, string>; afterKey?: string | null },
) =>
  request<{ contentHash: string; newKey: string; copiedAssets: string[] }>(
    `/api/decks/${deckId}/theme/insert`,
    jsonBody('POST', body),
  );

// --- Format (pretty-print slide HTML) ---
export const formatSlide = (id: string, html: string) =>
  request<{ html: string }>(`/api/decks/${id}/format`, jsonBody('POST', { html }));
/** Deck-agnostic HTML pretty-print (used by the theme slide editor). */
export const formatHtml = (html: string) =>
  request<{ html: string }>('/api/format', jsonBody('POST', { html }));

/** List the image URLs referenced on a web page (for the command-palette image picker). */
export const scrapeImages = (url: string) =>
  request<{ images: string[] }>('/api/scrape-images', jsonBody('POST', { url }));

// --- Slides Intelligence for theme templates (⌘K) ---
export const generateThemeSi = (
  themeId: string,
  body: { mode: 'compose' | 'replace'; code: string; selection?: string; prompt: string },
) => request<{ html: string }>(`/api/themes/${themeId}/si`, jsonBody('POST', body));
export const suggestThemeSiCompletion = (
  themeId: string,
  body: { prompt: string; mode: 'compose' | 'replace'; code?: string },
  signal?: AbortSignal,
) =>
  request<{ completion: string }>(`/api/themes/${themeId}/si/complete`, {
    ...jsonBody('POST', body),
    signal,
  });

// --- Video export (render one slide's fragment animations to an MP4) ---
export const exportSlideVideo = async (
  id: string,
  key: string,
  body: { durations: number[]; fps: number },
): Promise<Blob> => {
  const res = await fetch(
    `/api/decks/${id}/slides/${encodeURIComponent(key)}/video`,
    jsonBody('POST', body),
  );
  if (!res.ok) {
    let err: { error?: string; code?: string } | undefined;
    try {
      err = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, err?.error ?? res.statusText, err?.code);
  }
  return res.blob();
};

// --- Slides Intelligence (inline ⌘K) ---
export const generateSi = (
  id: string,
  body: { mode: 'compose' | 'replace' | 'section'; code: string; selection?: string; prompt: string },
) => request<{ html: string }>(`/api/decks/${id}/si`, jsonBody('POST', body));

// Ghost-text autocomplete for the SI prompt itself (abortable for stale-request cancel).
export const suggestSiCompletion = (
  id: string,
  body: { prompt: string; mode: 'compose' | 'replace'; code?: string },
  signal?: AbortSignal,
) =>
  request<{ completion: string }>(`/api/decks/${id}/si/complete`, {
    ...jsonBody('POST', body),
    signal,
  });

// --- Agent jobs ---
export const listJobs = (id: string) => request<Job[]>(`/api/decks/${id}/agent`);
export const enqueueJob = (
  id: string,
  body: { prompt: string; kind: JobKind; targetKey?: string | null },
) => request<Job>(`/api/decks/${id}/agent`, jsonBody('POST', body));
// Generate multiple coherent slides at once (plan → reserve → parallel fill agents).
export const generateSlides = (
  id: string,
  body: { topic: string; count: number; afterKey?: string | null },
) => request<{ batchId: string; keys: string[]; count: number }>(
  `/api/decks/${id}/agent/batch`,
  jsonBody('POST', body),
);
export const cancelJob = (id: string, jobId: string) =>
  request<void>(`/api/decks/${id}/agent/${jobId}/cancel`, { method: 'POST' });
