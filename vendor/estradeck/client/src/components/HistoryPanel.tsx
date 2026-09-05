import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function HistoryPanel() {
  const deckId = useStudio((s) => s.currentDeckId);
  const previewNonce = useStudio((s) => s.previewNonce);
  const showToast = useStudio((s) => s.showToast);
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!deckId) return;
    try {
      const { snapshots } = await api.listHistory(deckId);
      setSnaps(snapshots);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }, [deckId, showToast]);

  // Re-fetch on deck change and after every edit/restore (previewNonce bumps then).
  useEffect(() => {
    void refresh();
  }, [refresh, previewNonce]);

  if (!deckId) return <div className="panel-empty">No deck open.</div>;

  const restore = async (snap: Snapshot) => {
    setBusy(true);
    try {
      await api.restoreSnapshot(deckId, snap.id);
      showToast('success', `Restored — ${snap.label}`);
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="history-panel">
      <div className="hist-head">
        <button
          className="btn-sm"
          disabled={busy || !snaps?.length}
          title={snaps?.length ? `Undo: ${snaps[0].label}` : 'Nothing to undo'}
          onClick={() => snaps?.[0] && void restore(snaps[0])}
        >
          ↶ Undo last change
        </button>
        <span className="hist-note">Saved automatically before each edit.</span>
      </div>

      {snaps === null ? (
        <div className="panel-empty">Loading history…</div>
      ) : snaps.length === 0 ? (
        <div className="hist-empty">No history yet. Changes you make will appear here.</div>
      ) : (
        <ul className="hist-list">
          {snaps.map((s, i) => (
            <li className={`hist-item${i === 0 ? ' latest' : ''}`} key={s.id}>
              <div className="hist-meta">
                <span className="hist-label">{s.label}</span>
                <span className="hist-time">{ago(s.ts)}</span>
              </div>
              <button className="btn-sm" disabled={busy} onClick={() => void restore(s)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
