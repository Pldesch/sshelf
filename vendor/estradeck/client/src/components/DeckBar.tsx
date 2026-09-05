import { useState } from 'react';
import { useStudio } from '../state/deckStore';
import { presentDeck, downloadDeckPdf } from '../lib/deckActions';
import * as api from '../api/client';

export function DeckBar({
  layout,
  onToggleLayout,
}: {
  layout?: 'columns' | 'stacked';
  onToggleLayout?: () => void;
} = {}) {
  const mode = useStudio((s) => s.mode);
  const decks = useStudio((s) => s.decks);
  const themes = useStudio((s) => s.themes);
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const currentThemeId = useStudio((s) => s.currentThemeId);
  const selectDeck = useStudio((s) => s.selectDeck);
  const selectTheme = useStudio((s) => s.selectTheme);
  const refreshThemes = useStudio((s) => s.refreshThemes);
  const openNewDeck = useStudio((s) => s.openNewDeck);
  const duplicateDeck = useStudio((s) => s.duplicateDeck);
  const deleteDeck = useStudio((s) => s.deleteDeck);
  const showToast = useStudio((s) => s.showToast);

  async function newTheme() {
    const name = window.prompt('New theme name:');
    if (!name?.trim()) return;
    try {
      const { id } = await api.createTheme({ name: name.trim() });
      await refreshThemes();
      await selectTheme(id);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }

  function onPick(value: string) {
    if (!value) return;
    if (value.startsWith('theme:')) void selectTheme(value.slice('theme:'.length));
    else void selectDeck(value);
  }

  const [exporting, setExporting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  function present() {
    if (!currentDeckId) return;
    const { model, selectedKey } = useStudio.getState();
    presentDeck(currentDeckId, model, selectedKey);
  }

  async function exportPdf() {
    if (!currentDeckId || exporting) return;
    await downloadDeckPdf(currentDeckId, (state, message) => {
      if (state === 'start') setExporting(true);
      else {
        setExporting(false);
        showToast(state === 'done' ? 'success' : 'error', state === 'done' ? 'PDF downloaded' : message ?? 'Export failed');
      }
    });
  }

  async function duplicate() {
    if (!currentDeckId || duplicating) return;
    const cur = decks.find((d) => d.id === currentDeckId);
    const name = window.prompt('Name for the copy:', `${cur?.title ?? currentDeckId} copy`);
    if (name == null) return; // cancelled
    setDuplicating(true);
    try {
      await duplicateDeck(currentDeckId, name.trim() || undefined);
      showToast('success', 'Deck copied — now editing the copy');
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◆</span>{' '}
        <span className="brand-mark">
          <span className="bm-w">Estra</span><span className="bm-g">de</span><span className="bm-p">ck</span>
        </span>
      </div>
      <div className="deck-controls">
        <select
          value={mode === 'theme' ? `theme:${currentThemeId ?? ''}` : currentDeckId ?? ''}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="" disabled>
            Select a deck or theme…
          </option>
          <optgroup label="Decks">
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} ({d.slideCount})
              </option>
            ))}
          </optgroup>
          <optgroup label="Themes">
            {themes.map((t) => (
              <option key={t.id} value={`theme:${t.id}`}>
                ◐ {t.name}
              </option>
            ))}
          </optgroup>
        </select>
        <button onClick={openNewDeck}>＋ New deck</button>
        <button className="ghost" onClick={newTheme} title="Create a new theme">
          ＋ New theme
        </button>
        {mode === 'deck' && currentDeckId && (
          <button
            className="ghost icon-only"
            onClick={duplicate}
            disabled={duplicating}
            title="Duplicate — copy this deck (slides, styles, images, videos) to a new deck"
            aria-label="Duplicate deck"
          >
            {duplicating ? '⏳' : '⧉'}
          </button>
        )}
        {mode === 'deck' && currentDeckId && (
          <button
            className="ghost danger icon-only"
            onClick={() => {
              if (confirm('Delete this deck and all its files?')) deleteDeck(currentDeckId);
            }}
            title="Delete this deck and all its files"
            aria-label="Delete deck"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        )}
      </div>
      {mode === 'deck' && currentDeckId && (
        <div className="topbar-actions">
          {onToggleLayout && (
            <button
              className="ghost layout-btn icon-only"
              onClick={onToggleLayout}
              title={
                layout === 'stacked'
                  ? 'Switch to side-by-side (tabs on the right)'
                  : 'Switch to stacked (tabs at the bottom)'
              }
              aria-label="Toggle tabs position"
            >
              {layout === 'stacked' ? '◨' : '⬓'}
            </button>
          )}
          <button
            className="ghost export-btn icon-only"
            onClick={exportPdf}
            disabled={exporting}
            title="Export PDF — render every slide to a PDF and download it"
            aria-label="Export PDF"
          >
            {exporting ? '⏳' : '⤓'}
          </button>
          <button
            className="primary present-btn icon-only"
            onClick={present}
            title="Present — open the presentation in a new tab"
            aria-label="Present"
          >
            ▶
          </button>
        </div>
      )}
    </header>
  );
}
