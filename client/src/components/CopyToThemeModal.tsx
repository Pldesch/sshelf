import { useEffect, useState } from 'react';
import type { ThemeSummary } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

/**
 * Copy a deck slide into a theme as a new standard slide (its images are copied into the
 * theme's assets/). The author then adds {{placeholders}} in the Theme Manager.
 */
export function CopyToThemeModal({ slideKey, onClose }: { slideKey: string; onClose: () => void }) {
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const model = useStudio((s) => s.model);
  const selectTheme = useStudio((s) => s.selectTheme);
  const showToast = useStudio((s) => s.showToast);

  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [themeId, setThemeId] = useState<string>('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const slide = model?.slides.find((s) => s.key === slideKey);

  useEffect(() => {
    api
      .listThemes()
      .then((list) => {
        setThemes(list);
        setThemeId((cur) => cur || list[0]?.id || '');
      })
      .catch((e) => showToast('error', (e as Error).message));
    // Seed the name from the slide's title/id.
    setName(slide?.title || slide?.id || 'Slide');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (!currentDeckId || !themeId || busy) return;
    setBusy(true);
    try {
      const { slug, copiedAssets } = await api.createThemeSlideFromDeck(themeId, {
        deckId: currentDeckId,
        slideKey,
        name: name.trim() || undefined,
      });
      const n = copiedAssets.length;
      showToast('success', `Copied to theme${n ? ` (+${n} asset${n > 1 ? 's' : ''})` : ''}`, {
        label: 'Add placeholders',
        run: () => void selectTheme(themeId, slug),
      });
      onClose();
    } catch (e) {
      showToast('error', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="modal copy-theme" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Copy slide to a theme</span>
          <button className="icon-btn" title="Close" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="copy-theme-body">
          {themes && themes.length === 0 ? (
            <p className="tm-note">No themes yet — create one in the Theme Manager first.</p>
          ) : (
            <>
              <label className="tm-field">
                <span>Theme</span>
                <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                  {(themes ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tm-field">
                <span>Slide name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <p className="tm-note">
                The slide's images are copied into the theme. Afterwards, add{' '}
                <code>{'{{placeholders}}'}</code> in the Theme Manager.
              </p>
            </>
          )}
        </div>
        <div className="modal-foot it-foot">
          <span className="it-foot-note" />
          <button className="primary" disabled={busy || !themeId} onClick={copy}>
            {busy ? 'Copying…' : 'Copy to theme'}
          </button>
        </div>
      </div>
    </div>
  );
}
