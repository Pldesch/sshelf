import { useEffect, useState } from 'react';
import type { DeckThemeState, Theme, ThemeSummary } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

function isHex(v: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(v.trim());
}

function toHex6(v: string): string {
  let h = v.trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 7);
  return /^#[0-9a-f]{6}$/i.test(h) ? h : '#000000';
}

export function ThemePanel() {
  const deckId = useStudio((s) => s.currentDeckId);
  const previewNonce = useStudio((s) => s.previewNonce);
  const showToast = useStudio((s) => s.showToast);
  const setInspectorTab = useStudio((s) => s.setInspectorTab);

  const [state, setState] = useState<DeckThemeState | null>(null);
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [busy, setBusy] = useState(false);

  // Deck theme state + the list of available themes.
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    Promise.all([api.getDeckTheme(deckId), api.listThemes()])
      .then(([st, list]) => {
        if (!cancelled) {
          setState(st);
          setThemes(list);
        }
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [deckId, previewNonce, showToast]);

  // The full current theme (its palette), for the read-only inherited list.
  useEffect(() => {
    const tid = state?.themeId;
    if (!tid || state?.missing) {
      setTheme(null);
      return;
    }
    let cancelled = false;
    api
      .getTheme(tid)
      .then((t) => {
        if (!cancelled) setTheme(t);
      })
      .catch(() => {
        /* surfaced via deck-theme state */
      });
    return () => {
      cancelled = true;
    };
  }, [state?.themeId, state?.missing, previewNonce]);

  if (!deckId) return <div className="panel-empty">No deck open.</div>;
  if (!state || !themes) return <div className="panel-empty">Loading theme…</div>;

  const apply = async (themeId: string) => {
    if (!themeId || busy) return;
    setBusy(true);
    try {
      setState(await api.setDeckTheme(deckId, themeId));
      showToast('success', 'Theme applied');
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      setState(await api.syncDeckTheme(deckId));
      showToast('success', 'Synced from theme');
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const overrideNames = new Set(state.overrides.map((o) => o.name));

  return (
    <div className="theme-panel">
      <div className="cp-note">
        A <strong>theme</strong> is the deck's shared palette + fonts, materialized into{' '}
        <code>styles.css</code>. Values in the <strong>Colors</strong> tab override the theme for
        this deck.
      </div>

      <div className="cp-section-title">Theme</div>
      {themes.length === 0 ? (
        <div className="panel-empty small">No themes available.</div>
      ) : (
        <div className="tp-select-row">
          <select
            value={state.missing ? '' : state.themeId ?? ''}
            disabled={busy}
            onChange={(e) => apply(e.target.value)}
          >
            {(!state.themeId || state.missing) && (
              <option value="" disabled>
                Select a theme…
              </option>
            )}
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {state.themeId &&
            (state.missing ? (
              <span className="tp-pill tp-missing">Missing</span>
            ) : state.inSync ? (
              <span className="tp-pill tp-ok">In sync</span>
            ) : (
              <span className="tp-pill tp-stale">Out of date</span>
            ))}
        </div>
      )}

      {state.missing && (
        <div className="tp-alert">
          This deck references theme <code>{state.themeId}</code>, which no longer exists. Its
          palette is already baked into <code>styles.css</code>, so the deck still renders — pick a
          theme above to re-link.
        </div>
      )}

      {state.themeId && !state.missing && !state.inSync && (
        <button className="tp-btn" disabled={busy} onClick={sync}>
          Sync from theme
        </button>
      )}

      {theme && (
        <>
          <div className="cp-section-title">Palette &amp; fonts (inherited)</div>
          <div className="tp-vars">
            {theme.vars.map((v) => {
              const overridden = overrideNames.has(v.name);
              return (
                <div className="tp-var" key={v.name}>
                  <span
                    className={`tp-swatch${isHex(v.value) ? '' : ' tp-swatch-na'}`}
                    style={isHex(v.value) ? { background: toHex6(v.value) } : undefined}
                  />
                  <span className="cp-label">{v.name.replace(/^--/, '')}</span>
                  <span className={`tp-val${overridden ? ' tp-val-struck' : ''}`}>{v.value}</span>
                  {overridden && <span className="tp-pill tp-stale">overridden</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="cp-section-title">This deck's overrides</div>
      {state.overrides.length === 0 ? (
        <div className="cp-note">
          None — this deck uses the theme as-is. Edit a value in the{' '}
          <button className="tp-link" onClick={() => setInspectorTab('colors')}>
            Colors
          </button>{' '}
          tab to override it here.
        </div>
      ) : (
        <div className="cp-list">
          {state.overrides.map((o) => (
            <div className="cp-row" key={o.name}>
              <span className="cp-label">{o.name.replace(/^--/, '')}</span>
              <span className="tp-val">{o.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
