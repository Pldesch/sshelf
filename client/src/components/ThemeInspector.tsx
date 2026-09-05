import { useEffect, useRef, useState } from 'react';
import type { ThemeVar, ThemeSlideTemplate, ThemePlaceholder, ThemeAsset } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import { ThemeCodeEditor } from './ThemeCodeEditor';
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
function label(name: string): string {
  return name.replace(/^--/, '').replace(/-/g, ' ');
}

const TABS = [
  { id: 'slide', label: 'Slide' },
  { id: 'palette', label: 'Palette' },
  { id: 'theme', label: 'Theme' },
] as const;

/** Right pane in theme mode (mirrors the deck Inspector): edit the selected slide,
 *  the palette/fonts, or the theme's metadata. */
export function ThemeInspector() {
  const theme = useStudio((s) => s.theme);
  const themeSlug = useStudio((s) => s.themeSlug);
  const tab = useStudio((s) => s.themeInspectorTab);
  const setTab = useStudio((s) => s.setThemeInspectorTab);

  if (!theme) return <aside className="inspector"><div className="panel-empty">Loading theme…</div></aside>;

  return (
    <aside className="inspector">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'slide' &&
          (themeSlug ? (
            <ThemeSlideEditor key={`${theme.id}/${themeSlug}`} themeId={theme.id} slug={themeSlug} />
          ) : (
            <div className="panel-empty">No theme slide selected.</div>
          ))}
        {tab === 'palette' && <PalettePanel key={theme.id} />}
        {tab === 'theme' && <ThemeMetaPanel key={theme.id} />}
      </div>
    </aside>
  );
}

function PalettePanel() {
  const theme = useStudio((s) => s.theme)!;
  const bumpThemeNonce = useStudio((s) => s.bumpThemeNonce);
  const showToast = useStudio((s) => s.showToast);
  const [vars, setVars] = useState<ThemeVar[]>(theme.vars);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (name: string, value: string) => {
    const next = vars.map((v) => (v.name === name ? { ...v, value } : v));
    setVars(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const updated = await api.patchTheme(theme.id, { vars: next });
        useStudio.setState({ theme: updated });
        bumpThemeNonce(); // reload the preview with the new palette
      } catch (e) {
        showToast('error', (e as Error).message);
      }
    }, 400);
  };

  const colors = vars.filter((v) => isHex(v.value));
  const others = vars.filter((v) => !isHex(v.value));

  return (
    <div className="color-panel">
      <div className="cp-note">
        The theme's shared palette + fonts. Decks using this theme pick these up on{' '}
        <strong>Sync decks</strong>.
      </div>
      <div className="cp-section-title">Colors</div>
      <div className="cp-grid">
        {colors.map((v) => {
          const hex = isHex(v.value);
          return (
            <div className="cp-color" key={v.name}>
              <input
                type="color"
                value={hex ? toHex6(v.value) : '#000000'}
                disabled={!hex}
                onChange={(e) => update(v.name, e.target.value)}
              />
              <div className="cp-color-meta">
                <span className="cp-label">{label(v.name)}</span>
                <input className="cp-hex" value={v.value} onChange={(e) => update(v.name, e.target.value)} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="cp-section-title">Fonts &amp; sizes</div>
      <div className="cp-list">
        {others.map((v) => (
          <label className="cp-row" key={v.name}>
            <span className="cp-label">{label(v.name)}</span>
            <input value={v.value} onChange={(e) => update(v.name, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ThemeMetaPanel() {
  const theme = useStudio((s) => s.theme)!;
  const refreshTheme = useStudio((s) => s.refreshTheme);
  const refreshThemes = useStudio((s) => s.refreshThemes);
  const refreshDecks = useStudio((s) => s.refreshDecks);
  const selectDeck = useStudio((s) => s.selectDeck);
  const decks = useStudio((s) => s.decks);
  const showToast = useStudio((s) => s.showToast);

  const rename = async () => {
    const name = window.prompt('Rename theme:', theme.name);
    if (name == null || !name.trim()) return;
    try {
      await api.patchTheme(theme.id, { name: name.trim() });
      await refreshTheme();
      await refreshThemes();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const syncDecks = async () => {
    try {
      const { synced } = await api.syncDecksUsingTheme(theme.id);
      showToast('success', synced.length ? `Synced ${synced.length} deck(s)` : 'No decks use this theme');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete theme “${theme.name}”? Decks keep their baked-in palette.`)) return;
    try {
      await api.deleteTheme(theme.id);
      await refreshThemes();
      const next = decks[0]?.id;
      if (next) await selectDeck(next);
      await refreshDecks();
      showToast('success', 'Theme deleted');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  return (
    <div className="color-panel">
      <label className="tm-field">
        <span>Name</span>
        <div className="tmeta-name-row">
          <input value={theme.name} readOnly />
          <button className="ghost" onClick={rename}>
            Rename
          </button>
        </div>
      </label>
      {theme.description && <p className="tm-note">{theme.description}</p>}
      <div className="cp-section-title">Decks</div>
      <button className="tp-btn" onClick={syncDecks}>
        Sync decks using this theme
      </button>
      <p className="cp-note">
        Editing the palette doesn't touch existing decks until you sync — their values are
        materialized into each deck's <code>styles.css</code>.
      </p>
      <div className="cp-section-title">Danger zone</div>
      <button className="ghost danger" onClick={remove}>
        Delete theme
      </button>
    </div>
  );
}

function ThemeSlideEditor({ themeId, slug }: { themeId: string; slug: string }) {
  const refreshTheme = useStudio((s) => s.refreshTheme);
  const refreshThemes = useStudio((s) => s.refreshThemes);
  const selectThemeSlug = useStudio((s) => s.selectThemeSlug);
  const showToast = useStudio((s) => s.showToast);
  const [tpl, setTpl] = useState<ThemeSlideTemplate | null>(null);
  const [html, setHtml] = useState('');
  const [name, setName] = useState('');
  const [placeholders, setPlaceholders] = useState<ThemePlaceholder[]>([]);
  const [saving, setSaving] = useState(false);
  const [imageAssets, setImageAssets] = useState<ThemeAsset[]>([]);

  // Theme image assets, for choosing an image placeholder's default.
  useEffect(() => {
    api
      .listThemeAssets(themeId)
      .then((r) => setImageAssets(r.assets.filter((a) => a.kind === 'image')))
      .catch(() => setImageAssets([]));
  }, [themeId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getThemeSlide(themeId, slug)
      .then((t) => {
        if (cancelled) return;
        setTpl(t);
        setHtml(t.html);
        setName(t.name);
        setPlaceholders(t.placeholders);
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [themeId, slug, showToast]);

  const save = async () => {
    setSaving(true);
    try {
      const t = await api.putThemeSlide(themeId, slug, { name, html, placeholders });
      setTpl(t);
      setPlaceholders(t.placeholders);
      await refreshTheme(); // updates the slide list + reloads the center preview
      await refreshThemes();
      showToast('success', 'Slide saved');
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete theme slide “${name}”?`)) return;
    try {
      await api.deleteThemeSlide(themeId, slug);
      selectThemeSlug(null);
      await refreshTheme();
      await refreshThemes();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  if (!tpl) return <div className="panel-empty">Loading slide…</div>;

  const setPh = (key: string, patch: Partial<ThemePlaceholder>) =>
    setPlaceholders((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <div className="theme-slide-panel">
      <label className="tm-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="tm-field">
        <span>
          Template HTML — use <code>{'{{key}}'}</code> for placeholders
        </span>
        <ThemeCodeEditor themeId={themeId} value={html} onChange={setHtml} />
      </div>

      <div className="tm-se-subtitle">Placeholders</div>
      {placeholders.length === 0 ? (
        <div className="tm-note">
          None yet — add a <code>{'{{token}}'}</code> to the template and Save.
        </div>
      ) : (
        <div className="tm-ph-list">
          {placeholders.map((p) => (
            <div className="tm-ph" key={p.key}>
              <code className="tm-ph-key">{`{{${p.key}}}`}</code>
              <input
                className="tm-ph-label"
                placeholder="Label"
                value={p.label}
                onChange={(e) => setPh(p.key, { label: e.target.value })}
              />
              {p.type === 'image' ? (
                <select
                  className="tm-ph-default"
                  value={p.default}
                  onChange={(e) => setPh(p.key, { default: e.target.value })}
                >
                  <option value="">— theme image —</option>
                  {imageAssets.map((a) => (
                    <option key={a.ref} value={a.ref}>
                      {a.name}
                    </option>
                  ))}
                  {p.default && !imageAssets.some((a) => a.ref === p.default) && (
                    <option value={p.default}>{p.default}</option>
                  )}
                </select>
              ) : (
                <input
                  className="tm-ph-default"
                  placeholder="Default / sample value"
                  value={p.default}
                  onChange={(e) => setPh(p.key, { default: e.target.value })}
                />
              )}
              <select
                value={p.type ?? 'text'}
                onChange={(e) => setPh(p.key, { type: e.target.value as ThemePlaceholder['type'] })}
              >
                <option value="text">text</option>
                <option value="multiline">multiline</option>
                <option value="image">image</option>
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="tm-se-actions">
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save slide'}
        </button>
        <button className="ghost danger" onClick={remove}>
          Delete slide
        </button>
      </div>
    </div>
  );
}
