import { useEffect, useRef, useState } from 'react';
import type { ImageInfo, Theme, ThemePlaceholder, ThemeSlideTemplate, ThemeSummary } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

/** Resolve an image ref to a URL the preview IFRAME can load: deck refs (images/…) point
 *  at the deck (the theme harness's base can't resolve them); theme refs (assets/…) stay
 *  relative so the harness base resolves them. */
function resolveImageRef(ref: string, deckId: string | null): string {
  if (ref.startsWith('images/') && deckId) return `/decks/${deckId}/${ref}`;
  return ref;
}

/** Resolve an image ref to an absolute URL for a thumbnail rendered in THIS page (the form):
 *  deck images → the deck, theme assets → the theme. */
function thumbUrl(ref: string, deckId: string | null, themeId: string | null): string {
  if (!ref) return '';
  if (ref.startsWith('images/') && deckId) return `/decks/${deckId}/${ref}`;
  if (ref.startsWith('assets/') && themeId) return `/themes/${themeId}/${ref}`;
  return ref;
}

/**
 * Insert a theme standard slide into the current deck: pick a theme + slide, fill its
 * placeholders (with a live preview), then add it. Assets are copied into the deck.
 */
export function InsertThemeSlideModal({
  afterKey,
  onClose,
}: {
  afterKey: string | null;
  onClose: () => void;
}) {
  const deckId = useStudio((s) => s.currentDeckId);
  const selectSlide = useStudio((s) => s.selectSlide);
  const selectTheme = useStudio((s) => s.selectTheme);
  const showToast = useStudio((s) => s.showToast);

  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [tpl, setTpl] = useState<ThemeSlideTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [deckImages, setDeckImages] = useState<ImageInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // The deck's own images, to override an image placeholder's theme default.
  useEffect(() => {
    if (!deckId) return;
    api.listImages(deckId).then((r) => setDeckImages(r.images)).catch(() => setDeckImages([]));
  }, [deckId]);

  // Load themes + default to the deck's current theme.
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    Promise.all([api.listThemes(), api.getDeckTheme(deckId)])
      .then(([list, deckTheme]) => {
        if (cancelled) return;
        setThemes(list);
        const pick = (deckTheme.themeId && list.some((t) => t.id === deckTheme.themeId)
          ? deckTheme.themeId
          : list[0]?.id) ?? null;
        setThemeId(pick);
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [deckId, showToast]);

  // Load the chosen theme (its slide list).
  useEffect(() => {
    if (!themeId) {
      setTheme(null);
      return;
    }
    let cancelled = false;
    api
      .getTheme(themeId)
      .then((t) => {
        if (cancelled) return;
        setTheme(t);
        setSlug(t.slides[0]?.slug ?? null);
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [themeId, showToast]);

  // Load the chosen slide template + seed the form with defaults.
  useEffect(() => {
    if (!themeId || !slug) {
      setTpl(null);
      return;
    }
    let cancelled = false;
    api
      .getThemeSlide(themeId, slug)
      .then((t) => {
        if (cancelled) return;
        setTpl(t);
        const init: Record<string, string> = {};
        for (const p of t.placeholders) init[p.key] = p.default;
        setValues(init);
        setPreviewValues(init);
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [themeId, slug, showToast]);

  // Debounce the whole values object → preview, so the iframe doesn't reload on every
  // keystroke but always reflects ALL fields. Image refs are resolved to URLs the preview
  // iframe can load (deck images live outside the theme harness's base).
  useEffect(() => {
    const t = setTimeout(() => {
      const mapped: Record<string, string> = { ...values };
      for (const p of tpl?.placeholders ?? []) {
        if (p.type === 'image' && mapped[p.key]) mapped[p.key] = resolveImageRef(mapped[p.key], deckId);
      }
      setPreviewValues(mapped);
    }, 350);
    return () => clearTimeout(t);
  }, [values, tpl, deckId]);

  const setValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  // Keyboard-first: once a slide's fields render, focus the first placeholder (or the
  // slide picker if it has none) and select its text so you can overtype immediately.
  useEffect(() => {
    if (!tpl) return;
    const raf = requestAnimationFrame(() => {
      const root = modalRef.current;
      if (!root) return;
      const field =
        root.querySelector<HTMLElement>('.it-fields input, .it-fields textarea') ??
        root.querySelector<HTMLSelectElement>('select');
      field?.focus();
      if (field instanceof HTMLInputElement) field.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [tpl]);

  const add = async () => {
    if (!deckId || !themeId || !slug || busy) return;
    setBusy(true);
    try {
      const { newKey, copiedAssets } = await api.insertThemeSlide(deckId, {
        themeId,
        slug,
        values,
        afterKey,
      });
      selectSlide(newKey);
      const n = copiedAssets.length;
      showToast('success', `Slide added${n ? ` (+${n} asset${n > 1 ? 's' : ''})` : ''}`);
      onClose();
    } catch (e) {
      showToast('error', (e as Error).message);
      setBusy(false);
    }
  };

  const previewSrc = themeId && slug ? api.themeSlidePreviewUrl(themeId, slug, previewValues) : '';

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal insert-theme"
        ref={modalRef}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (!busy) onClose();
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
        }}
      >
        <div className="modal-head">
          <span className="modal-title">Add a theme slide</span>
          <button className="icon-btn" title="Close" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="it-body">
          <div className="it-form">
            <label className="tm-field">
              <span>Theme</span>
              <select
                value={themeId ?? ''}
                onChange={(e) => setThemeId(e.target.value || null)}
              >
                {(themes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            {theme && theme.slides.length === 0 ? (
              <div className="tm-note">
                This theme has no standard slides yet. Open the{' '}
                <button className="tp-link" onClick={() => { onClose(); void selectTheme(theme.id); }}>
                  open the theme
                </button>{' '}
                to add one.
              </div>
            ) : (
              <label className="tm-field">
                <span>Slide</span>
                <select value={slug ?? ''} onChange={(e) => setSlug(e.target.value || null)}>
                  {(theme?.slides ?? []).map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {tpl && tpl.placeholders.length > 0 && (
              <>
                <div className="it-fields-title">Fill in</div>
                <div className="it-fields">
                  {tpl.placeholders.map((p) =>
                    p.type === 'image' ? (
                      <ImageField
                        key={p.key}
                        placeholder={p}
                        deckId={deckId}
                        themeId={themeId}
                        deckImages={deckImages}
                        value={values[p.key] ?? p.default}
                        onChange={(v) => setValue(p.key, v)}
                      />
                    ) : (
                      <label className="tm-field" key={p.key}>
                        <span>{p.label}</span>
                        {p.type === 'multiline' ? (
                          <textarea
                            rows={2}
                            value={values[p.key] ?? ''}
                            onChange={(e) => setValue(p.key, e.target.value)}
                          />
                        ) : (
                          <input
                            value={values[p.key] ?? ''}
                            onChange={(e) => setValue(p.key, e.target.value)}
                          />
                        )}
                      </label>
                    ),
                  )}
                </div>
              </>
            )}
            {tpl && tpl.placeholders.length === 0 && (
              <div className="tm-note">This slide has no placeholders — it inserts as-is.</div>
            )}
          </div>

          <div className="it-preview">
            <div className="tm-se-preview-label">Live preview</div>
            <div className="tm-preview-frame">
              {previewSrc && <iframe title="Theme slide preview" src={previewSrc} />}
            </div>
          </div>
        </div>

        <div className="modal-foot it-foot">
          <span className="it-foot-note">
            {afterKey ? 'Added after the selected slide' : 'Added at the end'} · Tab between fields ·
            ⌘⏎ add · Esc cancel
          </span>
          <button className="primary" disabled={busy || !tpl} onClick={add}>
            {busy ? 'Adding…' : 'Add to deck'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** An image placeholder field: keep the theme default or pick one of the deck's images. */
function ImageField({
  placeholder: p,
  deckId,
  themeId,
  deckImages,
  value,
  onChange,
}: {
  placeholder: ThemePlaceholder;
  deckId: string | null;
  themeId: string | null;
  deckImages: ImageInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  const defaultName = p.default ? p.default.split('/').pop() : null;
  const src = thumbUrl(value || p.default, deckId, themeId);
  return (
    <label className="tm-field">
      <span>{p.label}</span>
      <div className="it-image-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value={p.default}>
            {defaultName ? `Theme default (${defaultName})` : 'Theme default'}
          </option>
          {deckImages.map((img) => (
            <option key={img.ref} value={img.ref}>
              {img.name}
            </option>
          ))}
        </select>
        {src && <img className="it-image-thumb" src={src} alt="" />}
      </div>
    </label>
  );
}
