import { create } from 'zustand';
import type { DeckModel, DeckSummary, Job, ServerMessage, Theme, ThemeSummary } from '@studio/shared';
import * as api from '../api/client';
import { resolveKey } from '../lib/locate';

export interface AgentLogEntry {
  id: number;
  kind: string;
  text: string;
}

export type ToastKind = 'info' | 'error' | 'success';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface StudioState {
  /** The workspace shows either a deck or a theme, using the same 3-pane shell. */
  mode: 'deck' | 'theme';
  decks: DeckSummary[];
  currentDeckId: string | null;
  model: DeckModel | null;
  selectedKey: string | null;

  // --- Theme workspace (mode === 'theme') ---
  themes: ThemeSummary[];
  currentThemeId: string | null;
  /** The full current theme (palette + slides), analogous to `model` for decks. */
  theme: Theme | null;
  /** Selected theme standard slide (slug). */
  themeSlug: string | null;
  /** Bumped on any theme mutation to refresh the theme nav + preview iframe. */
  themeNonce: number;
  /** Active tab in the theme Inspector (lifted to the store so the preview's Alt-click
   *  can switch to the Slide editor). */
  themeInspectorTab: 'slide' | 'palette' | 'theme';
  /** Pending "move the theme template editor's cursor to this element" request (Alt-click
   *  in the theme preview). path = element-child indices from the template <section>. */
  themeCodeJump: { path: number[]; nonce: number } | null;
  /** Desired fragment step for the selected slide; drives the preview. 'all' = fully revealed. */
  selectedStep: number | 'all';
  /** Fragment step the preview is actually showing (0 = base); for the navigator's active pill. */
  currentStep: number | null;
  previewNonce: number;
  loadingModel: boolean;
  /** True while the user is dragging a panel resize handle. The preview ignores reveal's
   *  resize-induced slide changes during this, then re-asserts the selected slide after. */
  resizing: boolean;
  toast: { kind: ToastKind; text: string; action?: ToastAction } | null;

  jobs: Job[];
  jobLogs: Record<string, AgentLogEntry[]>;

  /** Active Inspector tab. Lifted to the store so the slide editor can switch it
   *  (⌘-click a class → jump to the Styles tab). */
  inspectorTab: string;
  /** Pending "scroll the Styles editor to this selector" request; nonce re-triggers
   *  the same selector. Set by jumpToStyle, consumed by StyleEditor. */
  styleJump: { selector: string; nonce: number } | null;
  /** Pending "move the slide editor's cursor to this element" request (Alt-click in the
   *  preview). path = element-child indices from the slide <section>. Consumed by CodeEditor. */
  codeJump: { key: string; path: number[]; nonce: number } | null;
  setInspectorTab: (tab: string) => void;
  jumpToStyle: (selector: string) => void;
  /** Switch to the Code tab, select `key`, and put the cursor on the element at `path`. */
  jumpToElement: (key: string, path: number[]) => void;

  /** "Add slide from theme" modal (deck mode) — opened by ⌘I or the navigator's ❖. */
  insertTheme: { open: boolean; afterKey: string | null };
  openInsertThemeSlide: (afterKey?: string | null) => void;
  closeInsertThemeSlide: () => void;

  /** Command palette (⌘K) — fuzzy search over commands, slides, decks, themes. */
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  /** One-shot request to open the Agents tab in a given composer mode (consumed by the
   *  FleetPanel, which sets its mode + focuses the prompt). `pending` gates re-application. */
  agentIntent: { mode: 'create' | 'edit' | 'multi' | null; pending: boolean; nonce: number };
  requestAgent: (mode?: 'create' | 'edit' | 'multi') => void;
  consumeAgentIntent: () => void;

  /** Bumped to open the left navigator's Assets tab and refresh it (e.g. after fetching
   *  an image/video from the command palette). */
  assetsNonce: number;
  showAssets: () => void;

  /** "Import images from a website" picker — scrape a page, select images, import them. */
  imagePicker: { open: boolean; url: string };
  openImagePicker: (url?: string) => void;
  closeImagePicker: () => void;

  refreshThemes: () => Promise<void>;
  /** Switch the workspace to a theme (optionally selecting a standard slide). */
  selectTheme: (themeId: string, slug?: string) => Promise<void>;
  selectThemeSlug: (slug: string | null) => void;
  setThemeInspectorTab: (tab: 'slide' | 'palette' | 'theme') => void;
  /** Switch to the Slide editor and put the cursor on the template element at `path`. */
  jumpToThemeElement: (path: number[]) => void;
  /** Re-fetch the current theme and bump the refresh nonce. */
  refreshTheme: () => Promise<void>;
  /** Bump the theme refresh nonce only (reloads the preview) — used after palette edits. */
  bumpThemeNonce: () => void;

  refreshDecks: () => Promise<void>;
  selectDeck: (id: string, preferKey?: string) => Promise<void>;
  refreshModel: () => Promise<void>;
  selectSlide: (key: string) => void;
  /** Select a slide and scrub its preview to a specific fragment step (for the nav pills). */
  previewStepAt: (key: string, step: number) => void;
  setCurrentStep: (step: number | null) => void;
  setResizing: (v: boolean) => void;
  /** Create a deck and optionally associate it with a theme. */
  createDeck: (title: string, themeId?: string) => Promise<string>;
  /** "New deck" modal (name + theme), opened from the top bar or ⌘K. */
  newDeckOpen: boolean;
  openNewDeck: () => void;
  closeNewDeck: () => void;
  duplicateDeck: (id: string, title?: string) => Promise<string>;
  deleteDeck: (id: string) => Promise<void>;
  showToast: (kind: ToastKind, text: string, action?: ToastAction) => void;
  dismissToast: () => void;
  handleServerMessage: (msg: ServerMessage) => void;
}

let logId = 0;

function collectKeys(model: DeckModel): Set<string> {
  return new Set(model.slides.map((s) => s.key));
}

export const useStudio = create<StudioState>((set, get) => ({
  mode: 'deck',
  decks: [],
  currentDeckId: null,
  model: null,
  selectedKey: null,
  themes: [],
  currentThemeId: null,
  theme: null,
  themeSlug: null,
  themeNonce: 0,
  themeInspectorTab: 'slide',
  themeCodeJump: null,
  selectedStep: 'all',
  currentStep: null,
  previewNonce: 0,
  loadingModel: false,
  resizing: false,
  toast: null,
  jobs: [],
  jobLogs: {},
  inspectorTab: 'code',
  styleJump: null,
  codeJump: null,
  insertTheme: { open: false, afterKey: null },

  setInspectorTab(tab) {
    set({ inspectorTab: tab });
  },

  openInsertThemeSlide(afterKey) {
    set({ insertTheme: { open: true, afterKey: afterKey ?? null } });
  },
  closeInsertThemeSlide() {
    set({ insertTheme: { open: false, afterKey: null } });
  },

  paletteOpen: false,
  openPalette() {
    set({ paletteOpen: true });
  },
  closePalette() {
    set({ paletteOpen: false });
  },

  agentIntent: { mode: null, pending: false, nonce: 0 },
  requestAgent(mode) {
    set({
      inspectorTab: 'ai',
      agentIntent: { mode: mode ?? null, pending: true, nonce: get().agentIntent.nonce + 1 },
    });
  },
  consumeAgentIntent() {
    set({ agentIntent: { ...get().agentIntent, pending: false } });
  },

  assetsNonce: 0,
  showAssets() {
    set({ assetsNonce: get().assetsNonce + 1 });
  },

  imagePicker: { open: false, url: '' },
  openImagePicker(url) {
    set({ imagePicker: { open: true, url: url ?? '' } });
  },
  closeImagePicker() {
    set({ imagePicker: { open: false, url: '' } });
  },

  async refreshThemes() {
    try {
      set({ themes: await api.listThemes() });
    } catch (e) {
      get().showToast('error', (e as Error).message);
    }
  },

  async selectTheme(themeId, slug) {
    set({ mode: 'theme', currentThemeId: themeId, theme: null, themeSlug: slug ?? null });
    try {
      const theme = await api.getTheme(themeId);
      const resolved = slug && theme.slides.some((s) => s.slug === slug)
        ? slug
        : theme.slides[0]?.slug ?? null;
      set({ theme, themeSlug: resolved, themeNonce: get().themeNonce + 1 });
    } catch (e) {
      get().showToast('error', (e as Error).message);
    }
  },

  selectThemeSlug(slug) {
    set({ themeSlug: slug });
  },

  setThemeInspectorTab(tab) {
    set({ themeInspectorTab: tab });
  },

  jumpToThemeElement(path) {
    const nonce = (get().themeCodeJump?.nonce ?? 0) + 1;
    set({ themeInspectorTab: 'slide', themeCodeJump: { path, nonce } });
  },

  bumpThemeNonce() {
    set({ themeNonce: get().themeNonce + 1 });
  },

  async refreshTheme() {
    const id = get().currentThemeId;
    if (!id) return;
    try {
      const theme = await api.getTheme(id);
      const prev = get().themeSlug;
      const themeSlug = prev && theme.slides.some((s) => s.slug === prev)
        ? prev
        : theme.slides[0]?.slug ?? null;
      set({ theme, themeSlug, themeNonce: get().themeNonce + 1 });
    } catch (e) {
      get().showToast('error', (e as Error).message);
    }
  },

  jumpToStyle(selector) {
    const nonce = (get().styleJump?.nonce ?? 0) + 1;
    set({ inspectorTab: 'styles', styleJump: { selector, nonce } });
  },

  jumpToElement(key, path) {
    const nonce = (get().codeJump?.nonce ?? 0) + 1;
    get().selectSlide(key); // load the slide into the Code editor
    set({ inspectorTab: 'code', codeJump: { key, path, nonce } });
  },

  async refreshDecks() {
    try {
      set({ decks: await api.listDecks() });
    } catch (e) {
      get().showToast('error', (e as Error).message);
    }
  },

  async selectDeck(id, preferKey) {
    set({
      mode: 'deck',
      currentDeckId: id,
      loadingModel: true,
      model: null,
      selectedKey: null,
      selectedStep: 'all',
      currentStep: null,
      jobs: [],
      jobLogs: {},
    });
    try {
      const model = await api.getDeck(id);
      const preferred = preferKey ? resolveKey(model, preferKey) : null;
      set({
        model,
        selectedKey: preferred ?? model.slides[0]?.key ?? null,
        selectedStep: 'all',
        currentStep: null,
        loadingModel: false,
        previewNonce: get().previewNonce + 1,
      });
    } catch (e) {
      set({ loadingModel: false });
      get().showToast('error', (e as Error).message);
    }
  },

  async refreshModel() {
    const id = get().currentDeckId;
    if (!id) return;
    try {
      const model = await api.getDeck(id);
      const keys = collectKeys(model);
      const prev = get().selectedKey;
      const selectedKey = prev && keys.has(prev) ? prev : model.slides[0]?.key ?? null;
      set({ model, selectedKey, selectedStep: 'all', currentStep: null });
    } catch (e) {
      get().showToast('error', (e as Error).message);
    }
  },

  selectSlide(key) {
    set({ selectedKey: key, selectedStep: 'all', currentStep: null });
  },

  previewStepAt(key, step) {
    set({ selectedKey: key, selectedStep: step, currentStep: null });
  },

  setCurrentStep(step) {
    set({ currentStep: step });
  },

  setResizing(v) {
    set({ resizing: v });
  },

  async createDeck(title, themeId) {
    const { id } = await api.createDeck(title);
    if (themeId) {
      try {
        await api.setDeckTheme(id, themeId); // materialize the theme's palette into the deck
      } catch {
        /* theme association is best-effort — the deck is still created */
      }
    }
    await get().refreshDecks();
    await get().selectDeck(id);
    return id;
  },
  newDeckOpen: false,
  openNewDeck() {
    set({ newDeckOpen: true });
  },
  closeNewDeck() {
    set({ newDeckOpen: false });
  },

  async duplicateDeck(id, title) {
    const { id: newId } = await api.duplicateDeck(id, title);
    await get().refreshDecks();
    await get().selectDeck(newId);
    return newId;
  },

  async deleteDeck(id) {
    await api.deleteDeck(id);
    await get().refreshDecks();
    if (get().currentDeckId === id) {
      const next = get().decks[0]?.id ?? null;
      if (next) await get().selectDeck(next);
      else set({ currentDeckId: null, model: null, selectedKey: null });
    }
  },

  showToast(kind, text, action) {
    set({ toast: { kind, text, action } });
    setTimeout(
      () => {
        if (get().toast?.text === text) set({ toast: null });
      },
      action ? 8000 : 3800,
    );
  },

  dismissToast() {
    set({ toast: null });
  },

  handleServerMessage(msg) {
    const state = get();
    if ('deckId' in msg && msg.deckId && msg.deckId !== state.currentDeckId) return;
    switch (msg.type) {
      case 'deck-changed':
        void state.refreshModel();
        set({ previewNonce: get().previewNonce + 1 });
        break;
      case 'jobs-snapshot':
        set({ jobs: msg.jobs });
        break;
      case 'job-update': {
        const jobs = get().jobs.slice();
        const idx = jobs.findIndex((j) => j.id === msg.job.id);
        if (idx >= 0) jobs[idx] = msg.job;
        else jobs.push(msg.job);
        set({ jobs });
        break;
      }
      case 'job-log': {
        const logs = get().jobLogs[msg.jobId] ?? [];
        set({
          jobLogs: {
            ...get().jobLogs,
            [msg.jobId]: [...logs, { id: ++logId, kind: msg.kind, text: msg.text }],
          },
        });
        break;
      }
    }
  },
}));
