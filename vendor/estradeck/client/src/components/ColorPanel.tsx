import { useEffect, useRef, useState } from 'react';
import type { CssVar } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

function toHex6(v: string): string {
  let h = v.trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 7);
  return /^#[0-9a-f]{6}$/i.test(h) ? h : '#000000';
}

export function ColorPanel() {
  const deckId = useStudio((s) => s.currentDeckId);
  const previewNonce = useStudio((s) => s.previewNonce);
  const showToast = useStudio((s) => s.showToast);
  const [vars, setVars] = useState<CssVar[] | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const editingRef = useRef(false);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    api
      .getStyles(deckId)
      .then((v) => {
        if (!cancelled && !editingRef.current) setVars(v);
      })
      .catch((e) => showToast('error', (e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [deckId, previewNonce, showToast]);

  if (!deckId) return <div className="panel-empty">No deck open.</div>;
  if (!vars) return <div className="panel-empty">Loading styles…</div>;

  const update = (name: string, value: string) => {
    setVars((prev) => (prev ? prev.map((v) => (v.name === name ? { ...v, value } : v)) : prev));
    editingRef.current = true;
    if (timers.current[name]) clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(async () => {
      try {
        await api.putStyles(deckId, [{ name, value }]);
      } catch (e) {
        showToast('error', (e as Error).message);
      } finally {
        editingRef.current = false;
      }
    }, 400);
  };

  const colors = vars.filter((v) => v.kind === 'color');
  const others = vars.filter((v) => v.kind !== 'color');

  return (
    <div className="color-panel">
      <div className="cp-note">
        Deck-wide variables in <code>styles.css</code>. Per-slide backgrounds are in the Animation
        tab.
      </div>

      <div className="cp-section-title">Colors</div>
      <div className="cp-grid">
        {colors.map((v) => {
          const isHex = /^#[0-9a-f]{3,8}$/i.test(v.value.trim());
          return (
            <div className="cp-color" key={v.name}>
              <input
                type="color"
                value={isHex ? toHex6(v.value) : '#000000'}
                disabled={!isHex}
                title={isHex ? v.name : 'Edit non-hex values in the text field'}
                onChange={(e) => update(v.name, e.target.value)}
              />
              <div className="cp-color-meta">
                <span className="cp-label">{v.label}</span>
                <input
                  className="cp-hex"
                  value={v.value}
                  onChange={(e) => update(v.name, e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="cp-section-title">Typography &amp; layout</div>
      <div className="cp-list">
        {others.map((v) => (
          <label className="cp-row" key={v.name}>
            <span className="cp-label">{v.label}</span>
            <input value={v.value} onChange={(e) => update(v.name, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}
