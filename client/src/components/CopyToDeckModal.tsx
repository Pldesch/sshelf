import { useState } from 'react';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

/**
 * Pick a target deck to copy the given slide into. The server copies the slide's HTML
 * and any images/videos it uses; on success we offer a one-click jump to the target deck.
 */
export function CopyToDeckModal({ slideKey, onClose }: { slideKey: string; onClose: () => void }) {
  const decks = useStudio((s) => s.decks);
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const model = useStudio((s) => s.model);
  const selectDeck = useStudio((s) => s.selectDeck);
  const showToast = useStudio((s) => s.showToast);
  const [busy, setBusy] = useState<string | null>(null);

  const targets = decks.filter((d) => d.id !== currentDeckId);
  const slide = model?.slides.find((s) => s.key === slideKey);
  const slideName = slide?.title || slide?.id || 'this slide';

  async function copy(targetId: string, targetTitle: string) {
    if (busy || !currentDeckId) return;
    setBusy(targetId);
    try {
      const { copiedAssets } = await api.copySlideToDeck(currentDeckId, slideKey, targetId);
      const n = copiedAssets.length;
      const extra = n ? ` (+${n} asset${n > 1 ? 's' : ''})` : '';
      showToast('success', `Copied to “${targetTitle}”${extra}`, {
        label: 'Open',
        run: () => {
          void selectDeck(targetId);
        },
      });
      onClose();
    } catch (e) {
      showToast('error', (e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="modal copy-deck" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            Copy <strong>{slideName}</strong> to…
          </span>
          <button className="icon-btn" title="Close" disabled={!!busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="copy-deck-body">
          {targets.length === 0 ? (
            <p className="copy-deck-empty">No other decks yet — create another deck first.</p>
          ) : (
            <ul className="copy-deck-list">
              {targets.map((d) => (
                <li key={d.id}>
                  <button
                    className="copy-deck-item"
                    disabled={!!busy}
                    onClick={() => copy(d.id, d.title)}
                  >
                    <span className="copy-deck-name">{d.title}</span>
                    <span className="copy-deck-meta">
                      {busy === d.id ? '…' : `${d.slideCount} slide${d.slideCount === 1 ? '' : 's'} →`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-foot copy-deck-foot">
          Images &amp; videos the slide uses are copied too. It's added at the end of the target deck.
        </div>
      </div>
    </div>
  );
}
