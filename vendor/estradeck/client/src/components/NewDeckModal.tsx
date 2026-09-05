import { useEffect, useRef, useState } from 'react';
import type { ThemeSummary } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

/** Create a deck: give it a name and pick a theme (its palette/fonts are applied). The
 *  deck starts as a single title slide. Opened from the top bar's "＋ New deck" or ⌘K. */
export function NewDeckModal() {
  const close = useStudio((s) => s.closeNewDeck);
  const createDeck = useStudio((s) => s.createDeck);
  const showToast = useStudio((s) => s.showToast);

  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState<string>('');
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    api
      .listThemes()
      .then((list) => {
        setThemes(list);
        setThemeId((cur) => cur || list[0]?.id || ''); // default to the first theme, if any
      })
      .catch((e) => showToast('error', (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createDeck(name.trim(), themeId || undefined);
      close();
    } catch (e) {
      showToast('error', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && close()}>
      <div
        className="modal new-deck-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
          else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void create();
          }
        }}
      >
        <div className="modal-head">
          <span className="modal-title">New deck</span>
          <button className="icon-btn" title="Close" disabled={busy} onClick={close}>
            ×
          </button>
        </div>

        <div className="nd-body">
          <label className="tm-field">
            <span>Name</span>
            <input
              ref={nameRef}
              value={name}
              placeholder="Deck title"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="tm-field">
            <span>Theme</span>
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              <option value="">No theme (brand defaults)</option>
              {(themes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-foot it-foot">
          <span className="it-foot-note">⌘⏎ create · esc cancel</span>
          <button className="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create deck'}
          </button>
        </div>
      </div>
    </div>
  );
}
