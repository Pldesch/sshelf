import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageInfo, VideoInfo } from '@studio/shared';
import * as api from '../api/client';
import { useStudio } from '../state/deckStore';
import { findMention, filterMedia, applyMention, toMentionMedia, type MentionMedia } from '../lib/imageMention';
import { createGhostCompleter } from '../lib/ghostComplete';

interface Props {
  deckId: string;
  value: string;
  onChange: (v: string) => void;
  /** Called on ⌘/Ctrl-Enter (when the mention dropdown is not open). */
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  /** Open the @-mention dropdown upward (for inputs near the bottom of the screen). */
  menuAbove?: boolean;
  /** Enables ghost-text autocomplete by supplying the slide context for suggestions. */
  getCompletionContext?: () => { mode: 'compose' | 'replace'; code?: string };
}

/** A textarea with @media-mention autocomplete and AI ghost-text prompt completion. */
export function MentionTextarea({
  deckId,
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 3,
  menuAbove,
  getCompletionContext,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef(-1);
  const [assets, setAssets] = useState<{ images: ImageInfo[]; videos: VideoInfo[] }>({
    images: [],
    videos: [],
  });
  const [items, setItems] = useState<MentionMedia[]>([]);
  const [index, setIndex] = useState(0);
  const [suggestion, setSuggestion] = useState('');

  // Slides come from the live deck model so they stay current (added/removed/renamed).
  const slides = useStudio((s) => (s.model && s.model.deckId === deckId ? s.model.slides : []));
  const media = useMemo(
    () => toMentionMedia(assets.images, assets.videos, slides),
    [assets, slides],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listImages(deckId).then((r) => r.images).catch(() => []),
      api.listVideos(deckId).then((r) => r.videos).catch(() => []),
    ])
      .then(([images, videos]) => !cancelled && setAssets({ images, videos }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  // Ghost-text completer (created once; reads live props through refs).
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const ctxRef = useRef(getCompletionContext);
  ctxRef.current = getCompletionContext;
  const ghostRef = useRef<ReturnType<typeof createGhostCompleter>>();
  if (!ghostRef.current) {
    ghostRef.current = createGhostCompleter({
      complete: async (req, signal) => {
        const id = deckIdRef.current;
        if (!id) return '';
        const { completion } = await api.suggestSiCompletion(id, req, signal);
        return completion ?? '';
      },
      getContext: () => ctxRef.current?.() ?? { mode: 'compose' },
      onSuggestion: (text, forValue) => {
        if (ref.current && ref.current.value === forValue) setSuggestion(text);
      },
    });
  }
  const ghost = ghostRef.current;
  useEffect(() => () => ghost.cancel(), [ghost]);
  // Drop a stale suggestion when the prompt is changed/cleared from outside (e.g. reset
  // after submit). Only fires on actual value changes, so it never clobbers a fresh one.
  useEffect(() => setSuggestion(''), [value]);

  const open = items.length > 0;

  const refresh = (val: string, caret: number, all: MentionMedia[]) => {
    const m = findMention(val.slice(0, caret));
    if (!m) {
      startRef.current = -1;
      setItems([]);
      return;
    }
    startRef.current = m.start;
    setItems(filterMedia(all, m.query));
    setIndex(0);
  };

  // If a "@" was typed before media finished loading, back-fill once it arrives.
  useEffect(() => {
    const ta = ref.current;
    if (ta && document.activeElement === ta) refresh(value, ta.selectionStart ?? value.length, media);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  const acceptMention = (m: MentionMedia) => {
    const ta = ref.current;
    if (!ta) return;
    const { value: next, caret } = applyMention(value, ta.selectionStart ?? value.length, startRef.current, m.ref);
    setSuggestion('');
    ghost.cancel();
    onChange(next);
    setItems([]);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const acceptSuggestion = () => {
    const ta = ref.current;
    if (!ta || !suggestion) return;
    const next = value + suggestion;
    setSuggestion('');
    ghost.cancel();
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.length, next.length);
    });
  };

  const onType = (val: string, caret: number) => {
    onChange(val);
    refresh(val, caret, media);
    setSuggestion(''); // any stale ghost is no longer valid
    const mentionActive = !!findMention(val.slice(0, caret));
    if (getCompletionContext && !mentionActive && caret === val.length) ghost.schedule(val);
    else ghost.cancel();
  };

  // Clear a stale suggestion when the caret moves off the end (click / arrow nav).
  const syncCaret = () => {
    const ta = ref.current;
    if (ta && suggestion && (ta.selectionStart !== value.length || ta.selectionStart !== ta.selectionEnd)) {
      setSuggestion('');
    }
  };

  return (
    <div className="mention-wrap">
      {suggestion && (
        <div className="ghost-layer" aria-hidden="true">
          <span className="ghost-typed">{value}</span>
          <span className="ghost-suggestion">{suggestion}</span>
        </div>
      )}
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => (i + 1) % items.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => (i - 1 + items.length) % items.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              acceptMention(items[index]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // consumed dismissing the menu — don't also close a host popover
              setItems([]);
              return;
            }
          }
          // Ghost-text: Tab (or → at the end) accepts; Esc dismisses.
          if (suggestion) {
            const ta = e.currentTarget;
            const atEnd = ta.selectionStart === value.length && ta.selectionStart === ta.selectionEnd;
            if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) {
              e.preventDefault();
              acceptSuggestion();
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // consumed dismissing the ghost — don't also close a host popover
              setSuggestion('');
              ghost.cancel();
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setItems([]);
            setSuggestion('');
          }, 120)
        }
      />
      {open && (
        <div className={`mention-menu${menuAbove ? ' above' : ''}`}>
          {items.map((m, i) => (
            <div
              key={m.ref}
              className={`mention-item${i === index ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptMention(m);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              {m.thumbUrl ? (
                <img src={m.thumbUrl} alt="" />
              ) : (
                <span className="mention-thumb-ph">{m.kind === 'slide' ? '▤' : '▶'}</span>
              )}
              <span className="mention-name">{m.name}</span>
              {m.kind !== 'image' && <span className="mention-kind">{m.kind}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
