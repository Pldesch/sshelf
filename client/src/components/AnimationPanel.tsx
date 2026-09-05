import { useEffect, useState } from 'react';
import type { DeckConfig, FragmentElement } from '@studio/shared';
import {
  TRANSITIONS,
  TRANSITION_SPEEDS,
  FRAGMENT_EFFECTS,
  BACKGROUND_PRESETS,
} from '@studio/shared';
import { useStudio } from '../state/deckStore';
import { findSlide } from '../lib/locate';
import { highlightFragment, clearPreviewHighlight } from '../lib/previewHighlight';
import * as api from '../api/client';

export function AnimationPanel() {
  const model = useStudio((s) => s.model);
  const deckId = useStudio((s) => s.currentDeckId);
  const selectedKey = useStudio((s) => s.selectedKey);
  const previewNonce = useStudio((s) => s.previewNonce);
  const showToast = useStudio((s) => s.showToast);

  const slide = model && selectedKey ? findSlide(model, selectedKey) : null;
  const [frags, setFrags] = useState<FragmentElement[]>([]);
  const [deckCfg, setDeckCfg] = useState<DeckConfig | null>(null);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    api
      .getDeckConfig(deckId)
      .then((c) => {
        if (!cancelled) setDeckCfg(c);
      })
      .catch(() => {
        if (!cancelled) setDeckCfg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, previewNonce]);

  useEffect(() => {
    if (!deckId || !selectedKey) return;
    let cancelled = false;
    api
      .getFragments(deckId, selectedKey)
      .then((r) => {
        if (!cancelled) setFrags(r.elements);
      })
      .catch(() => {
        if (!cancelled) setFrags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, selectedKey, previewNonce]);

  // Clear the preview outline when the slide changes or the panel unmounts.
  useEffect(() => clearPreviewHighlight, [selectedKey]);

  if (!slide || !model || !deckId) {
    return <div className="panel-empty">Select a slide.</div>;
  }

  const patchSection = async (attrs: Record<string, string | boolean | null>) => {
    try {
      await api.patchSection(deckId, slide.key, attrs, model.contentHash);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const patchCfg = async (changes: Partial<DeckConfig>) => {
    try {
      setDeckCfg(await api.patchDeckConfig(deckId, changes));
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const patchFrag = async (
    elementIndex: number,
    body: { fragment: boolean; effect: string; fragmentIndex: number | null },
  ) => {
    try {
      await api.patchFragment(deckId, slide.key, elementIndex, body, model.contentHash);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const cls = slide.attrs.class ?? '';
  const activePreset = BACKGROUND_PRESETS.find((p) => new RegExp(`\\b${p.class}\\b`).test(cls));

  return (
    <div className="anim-panel" onMouseLeave={() => clearPreviewHighlight()}>
      <div className="anim-section">
        <div className="anim-title">Deck defaults</div>

        <label className="anim-row">
          <span>Transition</span>
          <select
            value={deckCfg?.transition ?? 'slide'}
            disabled={!deckCfg}
            onChange={(e) => patchCfg({ transition: e.target.value })}
          >
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="anim-row">
          <span>Speed</span>
          <select
            value={deckCfg?.transitionSpeed ?? 'default'}
            disabled={!deckCfg}
            onChange={(e) => patchCfg({ transitionSpeed: e.target.value })}
          >
            {TRANSITION_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="anim-hint">Applies to every slide unless a slide overrides it below.</div>
      </div>

      <div className="anim-section">
        <div className="anim-title">This slide</div>

        <label className="anim-row">
          <span>Transition</span>
          <select
            value={slide.attrs.transition ?? ''}
            onChange={(e) =>
              patchSection({ 'data-transition': e.target.value === '' ? null : e.target.value })
            }
          >
            <option value="">deck default</option>
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="anim-row">
          <span>Speed</span>
          <select
            value={slide.attrs.transitionSpeed ?? ''}
            onChange={(e) =>
              patchSection({
                'data-transition-speed': e.target.value === '' ? null : e.target.value,
              })
            }
          >
            <option value="">default</option>
            {TRANSITION_SPEEDS.filter((s) => s !== 'default').map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="anim-row checkbox">
          <input
            type="checkbox"
            checked={!!slide.attrs.autoAnimate}
            onChange={(e) => patchSection({ 'data-auto-animate': e.target.checked })}
          />
          <span>Auto-animate (match elements to the next slide)</span>
        </label>
      </div>

      <div className="anim-section">
        <div className="anim-title">Background</div>
        <div className="bg-presets">
          {BACKGROUND_PRESETS.map((p) => (
            <button
              key={p.class}
              className={`bg-chip${activePreset?.class === p.class ? ' active' : ''}`}
              style={{ background: p.color }}
              onClick={() =>
                patchSection({
                  class: mergeBrandClass(cls, p.class),
                  'data-background-color': p.color,
                })
              }
            >
              {p.label}
            </button>
          ))}
          <button
            className="bg-chip clear"
            onClick={() =>
              patchSection({
                class: stripBrandClasses(cls) || null,
                'data-background-color': null,
              })
            }
          >
            Clear
          </button>
        </div>
      </div>

      <div className="anim-section">
        <div className="anim-title">Fragments (reveal on click)</div>
        {frags.length === 0 && <div className="panel-empty small">No animatable elements.</div>}
        {frags.map((f) => (
          <div
            className="frag-row"
            key={f.elementIndex}
            onMouseEnter={() => highlightFragment(model, slide.key, f.elementIndex)}
          >
            <label className="frag-toggle">
              <input
                type="checkbox"
                checked={f.isFragment}
                onChange={(e) =>
                  patchFrag(f.elementIndex, {
                    fragment: e.target.checked,
                    effect: f.effects[0] ?? '',
                    fragmentIndex: f.fragmentIndex ?? null,
                  })
                }
              />
              <span className="frag-tag">{f.tag}</span>
              <span className="frag-snippet">{f.snippet}</span>
            </label>
            {f.isFragment && (
              <div className="frag-controls">
                <select
                  value={f.effects[0] ?? ''}
                  onChange={(e) =>
                    patchFrag(f.elementIndex, {
                      fragment: true,
                      effect: e.target.value,
                      fragmentIndex: f.fragmentIndex ?? null,
                    })
                  }
                >
                  <option value="">fade-in (default)</option>
                  {FRAGMENT_EFFECTS.map((eff) => (
                    <option key={eff} value={eff}>
                      {eff}
                    </option>
                  ))}
                </select>
                <input
                  className="frag-index"
                  type="number"
                  placeholder="#"
                  title="fragment index (order)"
                  value={f.fragmentIndex ?? ''}
                  onChange={(e) =>
                    patchFrag(f.elementIndex, {
                      fragment: true,
                      effect: f.effects[0] ?? '',
                      fragmentIndex: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function stripBrandClasses(cls: string): string {
  return cls
    .split(/\s+/)
    .filter((c) => c && !['on-purple', 'on-pink', 'on-dark', 'section-divider'].includes(c))
    .join(' ');
}

function mergeBrandClass(cls: string, brand: string): string {
  const base = stripBrandClasses(cls);
  return base ? `${base} ${brand}` : brand;
}
