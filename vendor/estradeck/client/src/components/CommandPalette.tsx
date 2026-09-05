import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../state/deckStore';
import { presentDeck, downloadDeckPdf } from '../lib/deckActions';
import * as api from '../api/client';

/** A command that, instead of running immediately, collects one more line of input (a URL). */
interface PromptStep {
  label: string;
  placeholder: string;
  working: string;
  submit: (value: string) => void;
}

interface PaletteItem {
  id: string;
  title: string;
  group: 'Actions' | 'Agents' | 'Tabs' | 'Slides' | 'Decks' | 'Themes';
  shortcut?: string;
  run?: () => void;
  prompt?: PromptStep;
}

/**
 * Case-insensitive fuzzy score: lower is better, Infinity = no match. A contiguous
 * substring match (e.g. "them" in "theme") is strongly preferred and ranked by how early
 * it starts; otherwise we fall back to subsequence matching with gap penalties.
 */
function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const sub = t.indexOf(q);
  if (sub !== -1) return -1000 + sub - (t.startsWith(q) ? 50 : 0);

  let ti = 0;
  let score = 0;
  let prev = -1;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return Infinity;
    score += found - ti;
    if (prev !== -1 && found !== prev + 1) score += 1;
    prev = found;
    ti = found + 1;
  }
  return score;
}

const GROUP_RANK: Record<PaletteItem['group'], number> = {
  Actions: 0,
  Agents: 1,
  Tabs: 2,
  Slides: 3,
  Decks: 4,
  Themes: 5,
};

/**
 * GitHub-style command palette (⌘K): fuzzy search over actions, inspector tabs, slides,
 * decks, and themes. Some commands (fetch an image/video from a URL) collect one more line
 * of input, then run the fetch and open the asset manager.
 */
export function CommandPalette() {
  const close = useStudio((s) => s.closePalette);
  const mode = useStudio((s) => s.mode);
  const decks = useStudio((s) => s.decks);
  const themes = useStudio((s) => s.themes);
  const model = useStudio((s) => s.model);
  const theme = useStudio((s) => s.theme);
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const currentThemeId = useStudio((s) => s.currentThemeId);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<PromptStep | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [pending]);

  const items = useMemo<PaletteItem[]>(() => {
    const st = useStudio.getState();
    const out: PaletteItem[] = [];
    const done = (fn: () => void) => () => {
      fn();
      st.closePalette();
    };
    // A "fetch from URL" command: collect the URL, then fetch + open the asset manager.
    const fetchCmd = (
      id: string,
      title: string,
      step: Omit<PromptStep, 'submit'>,
      run: (url: string) => Promise<unknown>,
    ): PaletteItem => ({
      id,
      title,
      group: 'Actions',
      prompt: {
        ...step,
        submit: (raw) => {
          const url = raw.trim();
          if (!url) return;
          st.closePalette();
          st.showAssets();
          st.showToast('info', step.working);
          run(url)
            .then(() => {
              st.showToast('success', 'Added to assets');
              st.showAssets();
            })
            .catch((e) => st.showToast('error', (e as Error).message));
        },
      },
    });

    // Always-available creation commands.
    const createThemeThen = (name: string, fromDeck?: string) => {
      const nm = name.trim();
      if (!nm) return;
      st.closePalette();
      api
        .createTheme({ name: nm, fromDeck })
        .then(({ id }) => st.refreshThemes().then(() => st.selectTheme(id)))
        .catch((e) => st.showToast('error', (e as Error).message));
    };
    out.push({ id: 'new-deck', title: 'New deck…', group: 'Actions', run: done(() => st.openNewDeck()) });
    out.push({
      id: 'new-theme',
      title: 'New theme…',
      group: 'Actions',
      prompt: { label: 'New theme', placeholder: 'Theme name…', working: '', submit: (v) => createThemeThen(v) },
    });
    if (currentDeckId) {
      out.push({
        id: 'new-theme-from-deck',
        title: 'New theme from the current deck…',
        group: 'Actions',
        prompt: {
          label: 'New theme from current deck',
          placeholder: 'Theme name…',
          working: '',
          submit: (v) => createThemeThen(v, currentDeckId),
        },
      });
    }

    // Open the website image picker (lists a page's images to preview + multi-select).
    const pickImagesCmd: PaletteItem = {
      id: 'pick-images',
      title: 'Import images from a website…',
      group: 'Actions',
      prompt: {
        label: 'Import images from a website',
        placeholder: 'Paste a website URL to list its images…',
        working: '',
        submit: (raw) => {
          const url = raw.trim();
          if (!url) return;
          st.closePalette();
          st.openImagePicker(url);
        },
      },
    };

    if (mode === 'deck' && currentDeckId) {
      out.push({
        id: 'present',
        title: 'Present — open the deck full-screen',
        group: 'Actions',
        shortcut: '⌘P',
        run: done(() => presentDeck(currentDeckId, useStudio.getState().model, useStudio.getState().selectedKey)),
      });
      out.push({
        id: 'download',
        title: 'Download deck as PDF',
        group: 'Actions',
        shortcut: '⌘E',
        run: done(() =>
          void downloadDeckPdf(currentDeckId, (state, msg) =>
            st.showToast(
              state === 'start' ? 'info' : state === 'done' ? 'success' : 'error',
              state === 'start' ? 'Exporting PDF…' : state === 'done' ? 'PDF downloaded' : msg ?? 'Export failed',
            ),
          ),
        ),
      });
      out.push({
        id: 'add-theme-slide',
        title: 'Add slide from theme…',
        group: 'Actions',
        shortcut: '⌘I',
        run: done(() => st.openInsertThemeSlide(useStudio.getState().selectedKey ?? null)),
      });
      out.push(
        fetchCmd(
          'img-url',
          'Upload image from a URL…',
          { label: 'Fetch image from a URL', placeholder: 'Paste an image URL…', working: 'Fetching image…' },
          (url) => api.addImageFromUrl(currentDeckId, url),
        ),
        fetchCmd(
          'video-url',
          'Add video from YouTube / URL…',
          { label: 'Download video from a URL', placeholder: 'Paste a YouTube or video URL…', working: 'Downloading video — this can take a minute…' },
          (url) => api.downloadVideo(currentDeckId, url),
        ),
        pickImagesCmd,
      );
      out.push({ id: 'agents-open', title: 'Open Agents tab', group: 'Agents', shortcut: '⌘A', run: done(() => st.requestAgent()) });
      out.push({ id: 'agents-create', title: 'Agents — create a new slide', group: 'Agents', run: done(() => st.requestAgent('create')) });
      out.push({ id: 'agents-edit', title: 'Agents — edit this slide', group: 'Agents', run: done(() => st.requestAgent('edit')) });
      out.push({ id: 'agents-multi', title: 'Agents — generate multiple slides', group: 'Agents', run: done(() => st.requestAgent('multi')) });
      for (const t of [
        { id: 'code', label: 'Code' },
        { id: 'styles', label: 'Styles' },
        { id: 'colors', label: 'Colors' },
        { id: 'theme', label: 'Theme' },
        { id: 'animate', label: 'Animation' },
      ]) {
        out.push({ id: `tab-${t.id}`, title: `Go to ${t.label} tab`, group: 'Tabs', run: done(() => st.setInspectorTab(t.id)) });
      }
      let n = 0;
      for (const s of model?.slides ?? []) {
        n += 1;
        const label = s.title || s.id || s.key;
        out.push({ id: `slide-${s.key}`, title: `Jump to slide ${n}: ${label}`, group: 'Slides', run: done(() => st.selectSlide(s.key)) });
      }
    }

    if (mode === 'theme' && currentThemeId && theme) {
      out.push(
        fetchCmd(
          'timg-url',
          'Upload image to theme from a URL…',
          { label: 'Fetch image into the theme', placeholder: 'Paste an image URL…', working: 'Fetching image…' },
          (url) => api.addThemeImageFromUrl(currentThemeId, url),
        ),
        fetchCmd(
          'tvideo-url',
          'Add video to theme from YouTube / URL…',
          { label: 'Download video into the theme', placeholder: 'Paste a YouTube or video URL…', working: 'Downloading video — this can take a minute…' },
          (url) => api.downloadThemeVideo(currentThemeId, url),
        ),
        pickImagesCmd,
      );
      for (const s of theme.slides) {
        out.push({ id: `tslide-${s.slug}`, title: `Theme slide: ${s.name}`, group: 'Slides', run: done(() => st.selectThemeSlug(s.slug)) });
      }
    }

    for (const d of decks) {
      if (mode === 'deck' && d.id === currentDeckId) continue;
      out.push({ id: `deck-${d.id}`, title: `Switch to deck: ${d.title}`, group: 'Decks', run: done(() => void st.selectDeck(d.id)) });
    }
    for (const t of themes) {
      if (mode === 'theme' && t.id === currentThemeId) continue;
      out.push({ id: `theme-${t.id}`, title: `Switch to theme: ${t.name}`, group: 'Themes', run: done(() => void st.selectTheme(t.id)) });
    }
    return out;
  }, [mode, decks, themes, model, theme, currentDeckId, currentThemeId]);

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: fuzzyScore(it.title, query) }))
      .filter((x) => Number.isFinite(x.score));
    scored.sort((a, b) =>
      query
        ? a.score - b.score
        : GROUP_RANK[a.it.group] - GROUP_RANK[b.it.group] || items.indexOf(a.it) - items.indexOf(b.it),
    );
    return scored.map((x) => x.it).slice(0, 60);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const activate = (it: PaletteItem | undefined) => {
    if (!it) return;
    if (it.prompt) {
      setPending(it.prompt);
      setQuery('');
      setActive(0);
    } else {
      it.run?.();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="cmd-palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (pending) {
              setPending(null);
              setQuery('');
            } else {
              close();
            }
          } else if (pending) {
            if (e.key === 'Enter') {
              e.preventDefault();
              pending.submit(query);
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            activate(filtered[active]);
          }
        }}
      >
        {pending && <div className="cmd-prompt-label">{pending.label}</div>}
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder={pending ? pending.placeholder : 'Search commands, slides, decks, themes…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {pending ? (
          <div className="cmd-foot">⏎ fetch · esc back</div>
        ) : (
          <>
            <div className="cmd-list" ref={listRef}>
              {filtered.length === 0 ? (
                <div className="cmd-empty">No matches.</div>
              ) : (
                filtered.map((it, i) => (
                  <button
                    key={it.id}
                    className={`cmd-item${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      activate(it);
                    }}
                  >
                    <span className="cmd-group">{it.group}</span>
                    <span className="cmd-title">{it.title}</span>
                    {it.prompt && <span className="cmd-more">›</span>}
                    {it.shortcut && <kbd className="cmd-kbd">{it.shortcut}</kbd>}
                  </button>
                ))
              )}
            </div>
            <div className="cmd-foot">↑↓ navigate · ⏎ run · esc close</div>
          </>
        )}
      </div>
    </div>
  );
}
