import { useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { setPending, clearPending, sectionInner, type SiGenerateReq } from '../lib/cmIntelligence';
import { MentionTextarea } from './MentionTextarea';

export interface SiSelection {
  from: number;
  to: number;
  text: string;
  fromLine: number;
  toLine: number;
}

interface Props {
  deckId: string;
  view: EditorView | null;
  /** Live editor selection (null when nothing is selected), kept in sync by the editor. */
  sel: SiSelection | null;
  generate: (req: SiGenerateReq) => Promise<string>;
  onError: (msg: string) => void;
}

/**
 * A persistent Slides Intelligence panel docked under the code editor. It mirrors the
 * editor's current selection — select lines and it targets them (no ⌘K needed); with
 * nothing selected it recomposes the whole slide.
 */
export function SiDock({ deckId, view, sel, generate, onError }: Props) {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'review'>('idle');
  const pending = useRef<{ from: number; len: number; original: string } | null>(null);

  const mode: 'compose' | 'replace' = sel ? 'replace' : 'compose';
  const target =
    sel != null
      ? sel.fromLine === sel.toLine
        ? `editing line ${sel.fromLine}`
        : `editing lines ${sel.fromLine}–${sel.toLine}`
      : 'whole slide';

  const submit = async () => {
    if (!view || !prompt.trim() || phase === 'loading') return;
    let from: number;
    let to: number;
    let selection: string | undefined;
    if (sel) {
      from = sel.from;
      to = sel.to;
      selection = sel.text;
    } else {
      const inner = sectionInner(view.state.doc.toString());
      from = inner.start;
      to = inner.end;
    }
    setPhase('loading');
    let html: string;
    try {
      html = await generate({ mode, code: view.state.doc.toString(), selection, prompt: prompt.trim() });
    } catch (e) {
      setPhase('idle');
      onError((e as Error).message || 'Generation failed');
      return;
    }
    const original = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: html },
      effects: setPending.of({ from, to: from + html.length }),
    });
    pending.current = { from, len: html.length, original };
    setPhase('review');
  };

  const accept = () => {
    view?.dispatch({ effects: clearPending.of(null) });
    pending.current = null;
    setPhase('idle');
    setPrompt('');
    view?.focus();
  };
  const discard = () => {
    const p = pending.current;
    if (p && view) {
      view.dispatch({
        changes: { from: p.from, to: p.from + p.len, insert: p.original },
        effects: clearPending.of(null),
      });
    }
    pending.current = null;
    setPhase('idle'); // keep the prompt so it can be tweaked and re-run
  };

  return (
    <div className="si-dock">
      <div className="si-dock-head">
        <span className="si-mark">✦ Slides Intelligence</span>
        <span className={`si-mode${sel ? ' sel' : ''}`}>{target}</span>
      </div>
      {phase === 'review' ? (
        <div className="si-review">
          <span className="si-review-label">Review the change in the editor &amp; preview</span>
          <button className="btn-sm si-accept" onClick={accept}>
            ✓ Accept
          </button>
          <button className="btn-sm" onClick={discard}>
            ✗ Discard
          </button>
        </div>
      ) : (
        <div className="si-dock-input">
          <MentionTextarea
            deckId={deckId}
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void submit()}
            getCompletionContext={() => ({
              mode,
              code: view?.state.doc.toString(),
            })}
            rows={2}
            menuAbove
            placeholder={
              sel
                ? 'Change the selected lines…  (@ slide/image/video, ⌘⏎)'
                : 'Add or change anything — AI places it…  (@ slide/image/video, ⌘⏎)'
            }
          />
          <button
            className="primary si-generate"
            disabled={phase === 'loading' || !prompt.trim() || !view}
            onClick={() => void submit()}
          >
            {phase === 'loading' ? '✦ Generating…' : '✦ Generate'}
          </button>
        </div>
      )}
    </div>
  );
}
