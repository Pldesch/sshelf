import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useStudio } from './state/deckStore';
import { createWsClient, type WsClient } from './api/ws';
import { DeckBar } from './components/DeckBar';
import { SlideNavigator } from './components/SlideNavigator';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { ThemeNavigator } from './components/ThemeNavigator';
import { ThemePreview } from './components/ThemePreview';
import { ThemeInspector } from './components/ThemeInspector';
import { InsertThemeSlideModal } from './components/InsertThemeSlideModal';
import { CommandPalette } from './components/CommandPalette';
import { ImagePicker } from './components/ImagePicker';
import { NewDeckModal } from './components/NewDeckModal';
import { navigateSlides, isTypingTarget } from './lib/slideNav';
import { presentDeck, downloadDeckPdf } from './lib/deckActions';

const NAV_MIN = 200;
const NAV_MAX = 560;
const INSP_MIN = 300;
const INSP_MAX = 760;
const STACK_MIN = 140;
const STACK_MAX = 820;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function loadWidth(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export default function App() {
  const mode = useStudio((s) => s.mode);
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const currentThemeId = useStudio((s) => s.currentThemeId);
  const selectedKey = useStudio((s) => s.selectedKey);
  const themeSlug = useStudio((s) => s.themeSlug);
  const refreshDecks = useStudio((s) => s.refreshDecks);
  const refreshThemes = useStudio((s) => s.refreshThemes);
  const insertTheme = useStudio((s) => s.insertTheme);
  const paletteOpen = useStudio((s) => s.paletteOpen);
  const imagePickerOpen = useStudio((s) => s.imagePicker.open);
  const newDeckOpen = useStudio((s) => s.newDeckOpen);
  const toast = useStudio((s) => s.toast);
  const wsRef = useRef<WsClient | null>(null);
  // Captured on first render before any URL write, so deep links survive mount.
  const initialParams = useRef(new URLSearchParams(window.location.search));

  const [navW, setNavW] = useState(() => loadWidth('studio.navW', 264));
  const [inspW, setInspW] = useState(() => loadWidth('studio.inspW', 400));
  const [inspH, setInspH] = useState(() => loadWidth('studio.inspH', 360));
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem('studio.navCollapsed') === '1',
  );
  const [layout, setLayout] = useState<'columns' | 'stacked'>(() =>
    localStorage.getItem('studio.layout') === 'stacked' ? 'stacked' : 'columns',
  );
  const [dragging, setDragging] = useState<null | 'nav' | 'insp' | 'stack'>(null);

  useEffect(() => {
    const ws = createWsClient((msg) => useStudio.getState().handleServerMessage(msg));
    wsRef.current = ws;
    void (async () => {
      await Promise.all([refreshDecks(), refreshThemes()]);
      const params = initialParams.current;
      const st = useStudio.getState();
      // ?theme= opens the theme workspace; otherwise fall back to ?deck=.
      const themeId = params.get('theme');
      if (themeId && st.themes.some((t) => t.id === themeId)) {
        await st.selectTheme(themeId, params.get('slug') ?? undefined);
        return;
      }
      const slideid = params.get('slideid') ?? undefined;
      // Deck from ?deck=, or the only deck when a slideid is given without one.
      let deck = params.get('deck');
      if (!deck && slideid && st.decks.length === 1) deck = st.decks[0].id;
      if (deck && st.decks.some((d) => d.id === deck)) {
        await st.selectDeck(deck, slideid);
      }
    })();
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentDeckId) wsRef.current?.subscribe(currentDeckId);
  }, [currentDeckId]);

  // Arrow up/down navigates slides in the left list (deck mode only; unless typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (useStudio.getState().mode !== 'deck') return;
      e.preventDefault();
      navigateSlides(e.key === 'ArrowDown' ? 'down' : 'up');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌘/Ctrl-I — "Add slide from theme" on the current deck (insert after the selected slide).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'i') return;
      const st = useStudio.getState();
      if (st.mode !== 'deck' || !st.currentDeckId) return;
      e.preventDefault();
      st.openInsertThemeSlide(st.selectedKey ?? null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌘K command palette + ⌘-letter action shortcuts (deck mode, not while typing — so
  // ⌘A / ⌘P keep their native meaning inside text fields and the editor).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const st = useStudio.getState();
      const k = e.key.toLowerCase();
      if (k === 'k') {
        if (st.paletteOpen) {
          e.preventDefault();
          st.closePalette();
          return;
        }
        // Only the code editor keeps ⌘K (= Slides Intelligence); from anywhere else —
        // including the Agents prompt and other inputs — ⌘K opens the command palette.
        if ((e.target as HTMLElement | null)?.closest?.('.cm-editor')) return;
        e.preventDefault();
        st.openPalette();
        return;
      }
      if (isTypingTarget(e.target) || st.paletteOpen || st.insertTheme.open) return;
      if (st.mode !== 'deck' || !st.currentDeckId) return;
      if (k === 'p') {
        e.preventDefault();
        presentDeck(st.currentDeckId, st.model, st.selectedKey);
      } else if (k === 'e') {
        e.preventDefault();
        void downloadDeckPdf(st.currentDeckId, (state, msg) =>
          st.showToast(
            state === 'start' ? 'info' : state === 'done' ? 'success' : 'error',
            state === 'start' ? 'Exporting PDF…' : state === 'done' ? 'PDF downloaded' : msg ?? 'Export failed',
          ),
        );
      } else if (k === 'a') {
        e.preventDefault();
        st.requestAgent();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep the URL in sync so it's copy-pasteable to reopen this deck slide / theme slide.
  useEffect(() => {
    const params = new URLSearchParams();
    if (mode === 'theme') {
      if (!currentThemeId) return;
      params.set('theme', currentThemeId);
      if (themeSlug) params.set('slug', themeSlug);
    } else {
      if (!currentDeckId) return;
      params.set('deck', currentDeckId);
      if (selectedKey) params.set('slideid', selectedKey);
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [mode, currentDeckId, selectedKey, currentThemeId, themeSlug]);

  useEffect(() => {
    localStorage.setItem('studio.navW', String(navW));
  }, [navW]);
  useEffect(() => {
    localStorage.setItem('studio.inspW', String(inspW));
  }, [inspW]);
  useEffect(() => {
    localStorage.setItem('studio.navCollapsed', navCollapsed ? '1' : '0');
  }, [navCollapsed]);
  useEffect(() => {
    localStorage.setItem('studio.inspH', String(inspH));
  }, [inspH]);
  useEffect(() => {
    localStorage.setItem('studio.layout', layout);
  }, [layout]);

  const startDrag = useCallback(
    (side: 'nav' | 'insp', e: ReactMouseEvent) => {
      e.preventDefault();
      setDragging(side);
      useStudio.getState().setResizing(true);
      const startX = e.clientX;
      const startNav = navW;
      const startInsp = inspW;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        if (side === 'nav') setNavW(clamp(startNav + dx, NAV_MIN, NAV_MAX));
        else setInspW(clamp(startInsp - dx, INSP_MIN, INSP_MAX));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDragging(null);
        useStudio.getState().setResizing(false);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [navW, inspW],
  );

  // Vertical resize of the bottom tabs panel in the stacked layout.
  const startVDrag = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setDragging('stack');
      useStudio.getState().setResizing(true);
      const startY = e.clientY;
      const startH = inspH;
      const onMove = (ev: MouseEvent) =>
        setInspH(clamp(startH - (ev.clientY - startY), STACK_MIN, STACK_MAX));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDragging(null);
        useStudio.getState().setResizing(false);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [inspH],
  );

  const workspaceStyle = {
    '--nav-w': `${navW}px`,
    '--insp-w': `${inspW}px`,
    '--insp-h': `${inspH}px`,
  } as CSSProperties;

  // The 3-pane shell is shared; only its contents differ between deck and theme mode.
  const isTheme = mode === 'theme';
  const hasContent = isTheme ? !!currentThemeId : !!currentDeckId;
  const navEl = isTheme ? (
    <ThemeNavigator onCollapse={() => setNavCollapsed(true)} />
  ) : (
    <SlideNavigator onCollapse={() => setNavCollapsed(true)} />
  );
  const previewEl = isTheme ? <ThemePreview /> : <Preview />;
  const inspectorEl = isTheme ? <ThemeInspector /> : <Inspector />;

  return (
    <div className="app">
      <DeckBar
        layout={layout}
        onToggleLayout={() => setLayout((l) => (l === 'stacked' ? 'columns' : 'stacked'))}
      />
      <main className={`workspace layout-${layout}`} style={workspaceStyle}>
        {hasContent ? (
          <>
            {/* Left navigator — always on the left, collapsible, in both modes. */}
            {navCollapsed ? (
              <button className="nav-rail" title="Show slides" onClick={() => setNavCollapsed(false)}>
                <span className="nav-rail-icon">»</span>
                <span className="nav-rail-label">{isTheme ? 'Theme slides' : 'Slides'}</span>
              </button>
            ) : (
              <>
                {navEl}
                <div
                  className={`gutter${dragging === 'nav' ? ' active' : ''}`}
                  onMouseDown={(e) => startDrag('nav', e)}
                  title="Drag to resize"
                />
              </>
            )}
            {/* Preview + tabs: side-by-side (tabs right) or stacked (tabs bottom). */}
            {layout === 'stacked' ? (
              <div className="content-stack">
                {previewEl}
                <div
                  className={`hgutter${dragging === 'stack' ? ' active' : ''}`}
                  onMouseDown={startVDrag}
                  title="Drag to resize"
                />
                <div className="stack-insp">{inspectorEl}</div>
              </div>
            ) : (
              <>
                {previewEl}
                <div
                  className={`gutter${dragging === 'insp' ? ' active' : ''}`}
                  onMouseDown={(e) => startDrag('insp', e)}
                  title="Drag to resize"
                />
                {inspectorEl}
              </>
            )}
          </>
        ) : (
          <div className="empty">
            <p>Nothing open.</p>
            <p className="muted">Pick a deck or theme from the menu above, or create one.</p>
          </div>
        )}
      </main>
      {insertTheme.open && mode === 'deck' && currentDeckId && (
        <InsertThemeSlideModal
          afterKey={insertTheme.afterKey}
          onClose={() => useStudio.getState().closeInsertThemeSlide()}
        />
      )}
      {paletteOpen && <CommandPalette />}
      {imagePickerOpen && <ImagePicker />}
      {newDeckOpen && <NewDeckModal />}
      {dragging && <div className={`drag-overlay${dragging === 'stack' ? ' row' : ''}`} />}
      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                const run = toast.action!.run;
                useStudio.getState().dismissToast();
                void run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
