import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/deckStore';
import { locate, keyAt, findSlide, isSlideHidden } from '../lib/locate';
import { navigateSlides, isTypingTarget } from '../lib/slideNav';
import { hideRevealControls } from '../lib/previewChrome';
import { attachAltPicker, elementPickInfo } from '../lib/previewHighlight';
import {
  attachRegionPicker,
  clearRegionMarquee,
  setRegionMarqueeBusy,
  composeRegionPrompt,
  type RegionContext,
  type RegionMode,
} from '../lib/regionPick';
import { sectionInner } from '../lib/cmIntelligence';
import { RegionPromptPopover } from './RegionPromptPopover';
import * as api from '../api/client';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function waitForReveal(w: any, cb: (reveal: any) => void, tries = 60) {
  try {
    if (w.Reveal && w.Reveal.isReady && w.Reveal.isReady()) {
      cb(w.Reveal);
      return;
    }
  } catch {
    return;
  }
  if (tries <= 0) return;
  setTimeout(() => waitForReveal(w, cb, tries - 1), 50);
}

// While we drive reveal programmatically, ignore reveal's own slidechanged events
// so the preview->selection sync can't fight the selection->preview effect (which
// would ping-pong between two slides when navigating fast / holding a key).
let suppressSyncUntil = 0;

/** Reveal fragments up to the desired step: 'all' = fully revealed, k = first k fragments. */
function applyFragmentState(reveal: any, step: number | 'all') {
  if (step === 'all') {
    let guard = 0;
    while (reveal.nextFragment() && guard++ < 300) {
      /* reveal every fragment so the slide looks complete */
    }
  } else {
    for (let i = 0; i < step; i++) reveal.nextFragment();
  }
}

/**
 * Jump the iframe's deck to the currently selected slide (read fresh from the store)
 * and set its fragment animation to the desired step.
 */
function jumpToSelected(reveal: any) {
  const { model, selectedKey, selectedStep } = useStudio.getState();
  if (!model || !selectedKey) return;
  const p = locate(model, selectedKey);
  if (!p) return;
  suppressSyncUntil = Date.now() + 400;
  reveal.slide(p.h, p.v, -1); // land on the slide with all fragments hidden
  applyFragmentState(reveal, selectedStep);
}

export function Preview() {
  const deckId = useStudio((s) => s.currentDeckId);
  const previewNonce = useStudio((s) => s.previewNonce);
  const selectedKey = useStudio((s) => s.selectedKey);
  const selectedStep = useStudio((s) => s.selectedStep);
  const model = useStudio((s) => s.model);
  const resizing = useStudio((s) => s.resizing);

  // The selected slide is hidden from the presentation → reveal can't show it, so we
  // overlay a notice instead of leaving the preview on a stale slide.
  const selectedSlide = model && selectedKey ? findSlide(model, selectedKey) : null;
  const selectedHidden = selectedSlide ? isSlideHidden(selectedSlide) : false;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Shift+Cmd marquee → an edit-agent prompt popover for the selected region.
  const [region, setRegion] = useState<{ pos: { left: number; top: number }; context: RegionContext } | null>(null);

  const closeRegion = () => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) clearRegionMarquee(doc);
    setRegion(null);
  };

  const submitRegion = (text: string, mode: RegionMode, wholeSection: boolean) => {
    const { currentDeckId, selectedKey: key, model: m } = useStudio.getState();
    const doc = iframeRef.current?.contentDocument;
    if (!region || !currentDeckId || !key) {
      closeRegion();
      return;
    }
    const prompt = composeRegionPrompt(text, region.context);

    if (mode === 'agent') {
      // Full agent job: enqueue an edit and jump to Agents to watch the transcript.
      api
        .enqueueJob(currentDeckId, { prompt, kind: 'edit', targetKey: key })
        .then(() => {
          useStudio.getState().setInspectorTab('ai');
          useStudio.getState().showToast('success', 'Agent queued for this region');
        })
        .catch((e) => useStudio.getState().showToast('error', (e as Error).message));
      closeRegion();
      return;
    }

    // Slide Intelligence: close the prompt but KEEP the marked rectangle on screen, pulsing,
    // as a live "still working" indicator until the one-shot returns (the toast auto-dismisses).
    // 'section' mode lets it rewrite the whole <section> (incl. inline style / background); an
    // inner-only result is spliced back into the existing section tag.
    const slide = m ? findSlide(m, key) : null;
    if (!slide || !m) {
      closeRegion();
      return;
    }
    const siMode = wholeSection ? 'section' : 'compose';
    setRegion(null); // close the popover, but leave the marquee up…
    if (doc) setRegionMarqueeBusy(doc, true); // …pulsing while the model works
    useStudio.getState().setInspectorTab('code'); // jump to the code editor
    useStudio.getState().showToast('info', 'Slide Intelligence…');
    api
      .generateSi(currentDeckId, { mode: siMode, code: slide.rawHtml, prompt })
      .then(async ({ html }) => {
        const out = html.trim();
        const next =
          siMode === 'section' && /^<section[\s>]/i.test(out)
            ? out
            : slide.rawHtml.slice(0, sectionInner(slide.rawHtml).start) +
              '\n' + out + '\n' +
              slide.rawHtml.slice(sectionInner(slide.rawHtml).end);
        await api.putSlide(currentDeckId, key, next, m.contentHash);
        await useStudio.getState().refreshModel();
        useStudio.getState().showToast('success', 'Slide updated');
      })
      .catch((e) => useStudio.getState().showToast('error', (e as Error).message))
      .finally(() => {
        if (doc) clearRegionMarquee(doc); // stop the pulse when finished (ok if the iframe already reloaded)
      });
  };

  // Close the region popover whenever the previewed slide/deck changes under it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => closeRegion, []);
  useEffect(() => {
    setRegion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, deckId, previewNonce]);

  // (Re)load the iframe on deck switch or file change. Always assign a fresh src
  // (with a nonce) so a mid-flight navigation is never reloaded to about:blank.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !deckId) return;
    iframe.src = `/decks/${deckId}/presentation.html?n=${previewNonce}`;
  }, [deckId, previewNonce]);

  // A panel resize can make reveal drift (the deck's own resize handlers re-fire). When
  // a resize ends, re-assert the selected slide so the preview matches the navigator.
  useEffect(() => {
    if (resizing) return;
    const w = iframeRef.current?.contentWindow as any;
    if (w) waitForReveal(w, jumpToSelected);
  }, [resizing]);

  // Jump to the selected slide and apply its fragment step. Retry until Reveal is
  // ready so a click made right after a load/reload is never silently dropped.
  useEffect(() => {
    const w = iframeRef.current?.contentWindow as any;
    if (!w || !selectedKey) return;
    waitForReveal(w, jumpToSelected);
  }, [selectedKey, selectedStep]);

  function handleLoad() {
    const w = iframeRef.current?.contentWindow as any;
    if (!w) return;
    hideRevealControls(w);

    // When the preview iframe has focus, make Up/Down navigate slides via the
    // studio (one slide per press) instead of letting reveal step through
    // fragments. Capture phase + stopPropagation beats reveal's own keydown
    // handler; Left/Right/Space still reach reveal for fragment stepping.
    try {
      w.document.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          navigateSlides(e.key === 'ArrowDown' ? 'down' : 'up');
        },
        true,
      );
    } catch {
      /* cross-origin shouldn't happen for same-origin deck */
    }

    // Hold Alt to highlight a slide element; Alt + left-click jumps to its source in the
    // Code tab so it can be edited directly.
    try {
      attachAltPicker(w.document, (el) => {
        const m = useStudio.getState().model;
        if (!m) return;
        const info = elementPickInfo(m, el);
        if (info) useStudio.getState().jumpToElement(info.key, info.path);
      });
    } catch {
      /* cross-origin shouldn't happen for same-origin deck */
    }

    // Shift+Cmd marquee → capture the region's context and open the edit-agent popover.
    try {
      attachRegionPicker(w.document, ({ anchor, context }) => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const ir = iframe.getBoundingClientRect(); // iframe content coords are iframe-viewport-relative
        const left = clamp(ir.left + anchor.left, 8, window.innerWidth - 452);
        const top = clamp(ir.top + anchor.top + anchor.height + 8, 8, window.innerHeight - 320);
        setRegion({ pos: { left, top }, context });
      });
    } catch {
      /* cross-origin shouldn't happen for same-origin deck */
    }

    waitForReveal(w, (reveal) => {
      // Never let the preview drop into reveal's "scroll view": when the pane gets narrow
      // (default activation < 435px) reveal stacks the slides and the mouse wheel scrolls
      // through them, which reflows the layout (flicker) and changes the active slide/hash
      // (the URL jumps) during a resize. Disabling it keeps a single, fixed slide that just
      // rescales. Set before the user can narrow the pane so it never activates. The deck
      // HTML disables it too; this also covers decks created before that change.
      try {
        reveal.configure({ scrollActivationWidth: null, mouseWheel: false });
      } catch {
        /* older reveal without scroll view; ignore */
      }

      // Keep the navigator highlight, the ?slideid= URL, and arrow-key selection in
      // sync when the user navigates with the preview's own arrow controls.
      const sync = () => {
        if (Date.now() < suppressSyncUntil) return; // our own jump, not user nav
        if (useStudio.getState().resizing) return; // ignore reveal drift during a resize
        const { model, selectedKey: cur, selectSlide } = useStudio.getState();
        if (!model || !reveal.getIndices) return;
        const { h } = reveal.getIndices();
        const key = keyAt(model, h);
        if (key && key !== cur) selectSlide(key);
      };
      // Report the current fragment step so the navigator's pills follow along when
      // the user steps fragments with the preview's own Left/Right controls. This is
      // display-only (it never drives the preview), so there's no feedback loop.
      const reportStep = () => {
        if (!reveal.getIndices) return;
        useStudio.getState().setCurrentStep(reveal.getIndices().f + 1);
      };
      try {
        reveal.on('slidechanged', sync);
        reveal.on('fragmentshown', reportStep);
        reveal.on('fragmenthidden', reportStep);
      } catch {
        /* older reveal API; ignore */
      }
      // On every (re)load, show the currently selected slide at its desired step.
      jumpToSelected(reveal);
    });
  }

  return (
    <section className="stage">
      <div className="stage-canvas">
        <iframe ref={iframeRef} title="Slide preview" className="preview-frame" onLoad={handleLoad} />
        {selectedHidden && (
          <div className="preview-hidden">
            <span className="preview-hidden-icon">🙈</span>
            <span>This slide is hidden from the presentation.</span>
            <span className="muted">Click the 👁 in the sidenav to show it.</span>
          </div>
        )}
      </div>
      {region && (
        <RegionPromptPopover
          pos={region.pos}
          context={region.context}
          deckId={deckId ?? ''}
          slideCode={selectedSlide?.rawHtml}
          onSubmit={submitRegion}
          onClose={closeRegion}
        />
      )}
    </section>
  );
}
