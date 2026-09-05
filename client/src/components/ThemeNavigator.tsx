import { useEffect, useState } from 'react';
import { useStudio } from '../state/deckStore';
import { ThemeAssetsPanel } from './ThemeAssetsPanel';
import * as api from '../api/client';

/** Left pane in theme mode: the theme's standard slides + assets (mirrors the deck SlideNavigator). */
export function ThemeNavigator({ onCollapse }: { onCollapse?: () => void }) {
  const theme = useStudio((s) => s.theme);
  const themeSlug = useStudio((s) => s.themeSlug);
  const selectThemeSlug = useStudio((s) => s.selectThemeSlug);
  const refreshTheme = useStudio((s) => s.refreshTheme);
  const refreshThemes = useStudio((s) => s.refreshThemes);
  const showToast = useStudio((s) => s.showToast);
  const assetsNonce = useStudio((s) => s.assetsNonce);
  const [tab, setTab] = useState<'slides' | 'assets'>('slides');

  useEffect(() => {
    if (assetsNonce > 0) setTab('assets');
  }, [assetsNonce]);

  const newSlide = async () => {
    if (!theme) return;
    const name = window.prompt('New theme slide name:');
    if (!name?.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'slide';
    const html =
      `<section class="on-purple" data-background-color="#5b24b9" style="justify-content:center">\n` +
      `  <p class="kicker">{{kicker}}</p>\n` +
      `  <h1 style="font-size:72pt">{{title}}</h1>\n` +
      `</section>`;
    try {
      await api.putThemeSlide(theme.id, slug, { name: name.trim(), html });
      await refreshTheme();
      await refreshThemes();
      selectThemeSlug(slug);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const remove = async (slug: string, name: string) => {
    if (!theme) return;
    if (!window.confirm(`Delete theme slide “${name}”?`)) return;
    try {
      await api.deleteThemeSlide(theme.id, slug);
      await refreshTheme();
      await refreshThemes();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  return (
    <aside className="nav">
      <div className="nav-head">
        <div className="nav-tabs">
          {(['slides', 'assets'] as const).map((id) => (
            <button
              key={id}
              className={`nav-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {id}
            </button>
          ))}
        </div>
        <span className="nav-head-actions">
          {tab === 'slides' && (
            <button className="icon-btn" title="Add a blank theme slide" onClick={newSlide}>
              ＋
            </button>
          )}
          {onCollapse && (
            <button className="icon-btn" title="Collapse panel" onClick={onCollapse}>
              «
            </button>
          )}
        </span>
      </div>
      {tab === 'assets' ? (
        <ThemeAssetsPanel />
      ) : !theme ? (
        <div className="nav-empty">Loading…</div>
      ) : theme.slides.length === 0 ? (
        <div className="nav-empty">
          No theme slides yet. Add one with ＋, or use a deck slide's “◐” action to copy one in.
        </div>
      ) : (
        <div className="nav-list">
          {theme.slides.map((s) => (
            <div className="nav-entry" key={s.slug}>
              <div
                className={`nav-item${themeSlug === s.slug ? ' selected' : ''}`}
                onClick={() => selectThemeSlug(s.slug)}
              >
                <span className="nav-swatch tm-nav-swatch" />
                <span className="nav-title">{s.name}</span>
                {s.placeholderCount > 0 && (
                  <span className="tm-nav-ph" title={`${s.placeholderCount} placeholders`}>
                    {s.placeholderCount}⌗
                  </span>
                )}
                <span className="nav-actions">
                  <button
                    className="icon-btn"
                    title="Delete theme slide"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(s.slug, s.name);
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
