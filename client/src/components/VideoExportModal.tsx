import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/deckStore';
import { findSlide, locate } from '../lib/locate';
import { hideRevealControls } from '../lib/previewChrome';
import * as api from '../api/client';

const DEFAULT_STEP_MS = 1500;
const FPS_OPTIONS = [24, 30, 60];

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RevealLike {
  isReady?: () => boolean;
  slide: (h: number, v: number, f: number) => void;
  nextFragment: () => boolean;
}

function fmtSecs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Per-slide "export as video" modal. Loads the deck in a hidden-ish preview iframe,
 * probes reveal for the slide's true number of fragment steps (incl. chart-driven
 * ones), lets the user tune a per-step timeline, simulates playback live, and on
 * export asks the server to render an MP4 and downloads it.
 */
export function VideoExportModal({ slideKey, onClose }: { slideKey: string; onClose: () => void }) {
  const deckId = useStudio((s) => s.currentDeckId);
  const model = useStudio((s) => s.model);
  const showToast = useStudio((s) => s.showToast);

  const slide = model ? findSlide(model, slideKey) : null;
  const h = model ? (locate(model, slideKey)?.h ?? 0) : 0;

  const [steps, setSteps] = useState<number | null>(null);
  const [durations, setDurations] = useState<number[]>([]);
  const [defaultMs, setDefaultMs] = useState(DEFAULT_STEP_MS);
  const [fps, setFps] = useState(30);
  const [playSeg, setPlaySeg] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);

  const getReveal = useCallback((): RevealLike | null => {
    const w = iframeRef.current?.contentWindow as any;
    return w && w.Reveal && w.Reveal.isReady?.() ? (w.Reveal as RevealLike) : null;
  }, []);

  const stopPlay = useCallback(() => {
    playingRef.current = false;
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    setPlaying(false);
  }, []);

  // Probe reveal for the real step count once the iframe deck is ready, then reset to
  // the base state. Retries until Reveal initialises.
  const onIframeLoad = useCallback(() => {
    hideRevealControls(iframeRef.current?.contentWindow);
    let tries = 0;
    const tryProbe = () => {
      const reveal = getReveal();
      if (!reveal) {
        if (tries++ < 80) setTimeout(tryProbe, 50);
        return;
      }
      reveal.slide(h, 0, -1);
      let n = 0;
      let guard = 0;
      while (reveal.nextFragment() && guard++ < 300) n++;
      reveal.slide(h, 0, -1);
      setSteps(n);
      setDurations(Array.from({ length: n + 1 }, () => DEFAULT_STEP_MS));
      setPlaySeg(-1);
    };
    tryProbe();
  }, [getReveal, h]);

  // Simulate the configured timeline in the preview iframe.
  const play = useCallback(() => {
    const reveal = getReveal();
    if (!reveal || steps == null) return;
    reveal.slide(h, 0, -1);
    playingRef.current = true;
    setPlaying(true);
    let seg = 0;
    setPlaySeg(0);
    const schedule = () => {
      playTimer.current = setTimeout(() => {
        if (!playingRef.current) return;
        if (seg >= steps) {
          stopPlay();
          return;
        }
        reveal.nextFragment();
        seg += 1;
        setPlaySeg(seg);
        schedule();
      }, durations[seg] ?? defaultMs);
    };
    schedule();
  }, [getReveal, steps, h, durations, defaultMs, stopPlay]);

  // Stop playback / timers on unmount.
  useEffect(() => () => stopPlay(), [stopPlay]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !rendering) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, rendering]);

  const setSegment = (i: number, secs: number) => {
    const ms = Math.min(60_000, Math.max(100, Math.round(secs * 1000)));
    setDurations((d) => d.map((v, k) => (k === i ? ms : v)));
  };

  const applyDefaultToAll = (secs: number) => {
    const ms = Math.min(60_000, Math.max(100, Math.round(secs * 1000)));
    setDefaultMs(ms);
    setDurations((d) => d.map(() => ms));
  };

  const totalMs = durations.reduce((a, b) => a + b, 0);

  const exportVideo = async () => {
    if (!deckId || rendering || durations.length === 0) return;
    stopPlay();
    setRendering(true);
    try {
      const blob = await api.exportSlideVideo(deckId, slideKey, { durations, fps });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deckId}-${slideKey}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('success', 'Video downloaded');
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  if (!deckId) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => !rendering && onClose()}>
      <div className="modal video-export" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            Export as video — {slide?.title || slide?.id || slideKey}
          </span>
          <button className="icon-btn" title="Close" disabled={rendering} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="ve-preview">
          <iframe
            ref={iframeRef}
            title="Video preview"
            className="ve-frame"
            src={`/decks/${deckId}/presentation.html?ve=1`}
            onLoad={onIframeLoad}
          />
          <div className="ve-preview-bar">
            {playing ? (
              <button className="btn-sm" onClick={stopPlay}>
                ❚❚ Pause
              </button>
            ) : (
              <button className="btn-sm" disabled={steps == null} onClick={play}>
                ▶ Play preview
              </button>
            )}
            <span className="ve-est">
              {steps == null
                ? 'Analyzing animations…'
                : `${steps} step${steps === 1 ? '' : 's'} · est. ${fmtSecs(totalMs)} · ${fps}fps · 1920×1080 mp4`}
            </span>
          </div>
        </div>

        {steps != null && (
          <div className="ve-controls">
            <div className="ve-row">
              <label>
                Default per step
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={(defaultMs / 1000).toFixed(1)}
                  onChange={(e) => applyDefaultToAll(Number(e.target.value) || 0.1)}
                />
                s
              </label>
              <label>
                Frame rate
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {FPS_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="ve-timeline">
              {durations.map((ms, i) => (
                <div
                  key={i}
                  className={`ve-seg${playSeg === i ? ' on' : ''}`}
                  title={i === 0 ? 'Hold on the base slide' : `Hold after animation step ${i}`}
                >
                  <span className="ve-seg-label">{i === 0 ? 'Base' : `Step ${i}`}</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={(ms / 1000).toFixed(1)}
                    onChange={(e) => setSegment(i, Number(e.target.value) || 0.1)}
                  />
                  <span className="ve-seg-unit">s</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-foot">
          {rendering && (
            <span className="ve-rendering">
              Rendering {fmtSecs(totalMs)} of video in real time — please wait…
            </span>
          )}
          <button className="ghost" disabled={rendering} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={rendering || steps == null}
            onClick={() => void exportVideo()}
          >
            {rendering ? 'Rendering…' : '⬇ Export video'}
          </button>
        </div>
      </div>
    </div>
  );
}
