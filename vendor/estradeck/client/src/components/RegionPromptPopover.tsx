import { useEffect, useRef, useState } from 'react';
import type { RegionContext, RegionMode } from '../lib/regionPick';
import { MentionTextarea } from './MentionTextarea';

// Remember the last engine + scope choice across marquee selections.
let lastMode: RegionMode = 'si';
let lastWholeSection = true;

/**
 * "Magic Frame" — the floating prompt over the preview, opened by a Shift+Cmd marquee
 * selection. The user types an instruction (with @-mentions for images / videos / slides,
 * like the other prompt fields) and picks an engine — Slide Intelligence (one-shot, applied
 * in place, jumps to the Code editor) or the full Agent (Agents tab). The marked region is
 * inlined as context.
 */
export function RegionPromptPopover({
  pos,
  context,
  deckId,
  slideCode,
  onSubmit,
  onClose,
}: {
  pos: { left: number; top: number };
  context: RegionContext;
  deckId: string;
  /** Current slide HTML, for the prompt's ghost-text completion context. */
  slideCode?: string;
  /** wholeSection only applies to Slide Intelligence (rewrite the <section> vs its body only). */
  onSubmit: (text: string, mode: RegionMode, wholeSection: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<RegionMode>(lastMode);
  const [wholeSection, setWholeSection] = useState(lastWholeSection);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wrapRef.current?.querySelector('textarea')?.focus();
  }, []);

  const send = () => {
    const t = text.trim();
    if (t) onSubmit(t, mode, wholeSection);
  };

  const w = context.pct.right - context.pct.left;
  const h = context.pct.bottom - context.pct.top;
  const summary = `${context.elements.length} element${context.elements.length === 1 ? '' : 's'} · ${w}%×${h}%`;

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 1000,
        width: 440,
        padding: 12,
        background: '#1c1c2a',
        border: '1px solid #2a2a3c',
        borderRadius: 10,
        boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
        color: '#ececf4',
        font: '13px Inter, system-ui, sans-serif',
      }}
      ref={wrapRef}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#ececf4', letterSpacing: '0.01em' }}>
          <span style={{ color: '#22d3ee' }}>✦</span> Magic Frame
        </span>
        <span style={{ marginLeft: 'auto', color: '#9a9ab0', fontSize: 11 }}>{summary}</span>
        <button
          onClick={onClose}
          title="Close"
          style={{ background: 'none', border: 0, color: '#9a9ab0', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <select
          value={mode}
          onChange={(e) => {
            const m = e.target.value as RegionMode;
            setMode(m);
            lastMode = m;
          }}
          title="Slide Intelligence = one-shot completion (jumps to the code editor). Agent = full agent job."
          style={{
            background: '#11111a',
            color: '#ececf4',
            border: '1px solid #2a2a3c',
            borderRadius: 6,
            padding: '3px 6px',
            font: '12px Inter, system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          <option value="si">✦ Slide Intelligence</option>
          <option value="agent">✎ Agent</option>
        </select>
        {context.areaColor && (
          <span
            title={`Region background · ${context.areaColor}`}
            style={{
              width: 12, height: 12, borderRadius: 3, background: context.areaColor,
              border: '1px solid rgba(255,255,255,0.3)',
            }}
          />
        )}
      </div>

      {context.elements.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {context.elements.map((el, i) => (
            <span
              key={i}
              title={el.html} // full markup (with inline styles) on hover
              style={{
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                background: '#11111a',
                border: '1px solid #2a2a3c',
                borderRadius: 5,
                padding: '2px 7px',
                fontSize: 11,
                color: '#c9c9dd',
                cursor: 'default',
              }}
            >
              {el.label}
            </span>
          ))}
        </div>
      )}

      {mode === 'si' && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: '#c9c9dd', cursor: 'pointer' }}
          title="On: rewrite the whole <section>, so it can change the slide's background / inline styles. Off: only its inner content."
        >
          <input
            type="checkbox"
            checked={wholeSection}
            onChange={(e) => {
              setWholeSection(e.target.checked);
              lastWholeSection = e.target.checked;
            }}
          />
          Rewrite whole section (styles &amp; background)
        </label>
      )}

      <MentionTextarea
        deckId={deckId}
        rows={5}
        placeholder={
          mode === 'si'
            ? 'Describe the one-shot change…  (@ image/video/slide) ⌘⏎ to run'
            : 'Tell the agent what to change…  (@ image/video/slide) ⌘⏎ to send'
        }
        value={text}
        onChange={setText}
        onSubmit={send}
        getCompletionContext={() => ({ mode: 'compose', code: slideCode })}
      />
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
        <span style={{ color: '#9a9ab0', fontSize: 11 }}>⌘⏎ send · esc cancel</span>
        <button
          onClick={send}
          disabled={!text.trim()}
          style={{
            marginLeft: 'auto',
            background: text.trim() ? '#7a3cf6' : '#3a3a4c',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '6px 12px',
            cursor: text.trim() ? 'pointer' : 'default',
            font: '13px Inter, system-ui, sans-serif',
          }}
        >
          {mode === 'si' ? 'Run intelligence' : 'Send to agent'}
        </button>
      </div>
    </div>
  );
}
