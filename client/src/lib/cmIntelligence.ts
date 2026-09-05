import { EditorView, keymap, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { findMention, filterMedia, applyMention, type MentionMedia } from './imageMention';
import { createGhostCompleter } from './ghostComplete';

export interface SiGenerateReq {
  /** compose = recompose the whole slide body (model decides placement); replace = rewrite the selection. */
  mode: 'compose' | 'replace';
  code: string;
  selection?: string;
  prompt: string;
}
/** Provided by the editor: turns a prompt + context into a slide-HTML chunk. */
export type SiGenerate = (req: SiGenerateReq) => Promise<string>;
/** Provided by the editor: the deck's/theme's media (images + videos), for @-mentions. */
export type SiGetMedia = () => Promise<MentionMedia[]>;
/** Provided by the editor: fetch a ghost-text continuation for the prompt (deck or theme). */
export type SiComplete = (
  req: { prompt: string; mode: 'compose' | 'replace'; code?: string },
  signal: AbortSignal,
) => Promise<string>;

// --- pending-change highlight (the "diff in editor") — shared with the docked SI panel ---
export const setPending = StateEffect.define<{ from: number; to: number }>();
export const clearPending = StateEffect.define<null>();
const pendingMark = Decoration.mark({ class: 'cm-si-pending' });

const pendingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPending)) deco = Decoration.set([pendingMark.range(e.value.from, e.value.to)]);
      else if (e.is(clearPending)) deco = Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  '.cm-si-pending': {
    backgroundColor: 'rgba(95, 220, 140, 0.18)',
    boxShadow: 'inset 2px 0 0 rgba(95, 220, 140, 0.9)',
    borderRadius: '2px',
  },
});

const PANEL_W = 380;

/** Content range inside the slide's single <section>, so inserts never land outside it. */
export function sectionInner(doc: string): { start: number; end: number } {
  const open = doc.indexOf('<section');
  const openEnd = open >= 0 ? doc.indexOf('>', open) + 1 : 0;
  const close = doc.lastIndexOf('</section>');
  const start = openEnd > 0 ? openEnd : 0;
  const end = close >= 0 ? close : doc.length;
  return start <= end ? { start, end } : { start: 0, end: doc.length };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function openSi(view: EditorView, generate: SiGenerate, getMedia: SiGetMedia, complete: SiComplete) {
  if (view.dom.querySelector('.cm-si-open')) return; // one at a time
  const sel = view.state.selection.main;
  const hasSel = !sel.empty;
  const mode: 'compose' | 'replace' = hasSel ? 'replace' : 'compose';
  let from: number;
  let to: number;
  if (hasSel) {
    from = sel.from;
    to = sel.to;
  } else {
    // No selection: hand the whole <section> body to the model and let it decide
    // placement. We replace only the inner content, keeping the <section> tag
    // (and its id/classes/background) untouched.
    const inner = sectionInner(view.state.doc.toString());
    from = inner.start;
    to = inner.end;
  }
  const selection = hasSel ? view.state.sliceDoc(from, to) : undefined;

  const panel = el('div', {
    position: 'fixed',
    zIndex: '1200',
    width: `${PANEL_W}px`,
    padding: '10px',
    background: '#181826',
    border: '1px solid #34344a',
    borderRadius: '12px',
    boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
    color: '#ececf4',
    font: '13px Inter, system-ui, sans-serif',
  });
  panel.className = 'cm-si-open';

  // anchor under the cursor / selection end
  const coords = view.coordsAtPos(hasSel ? to : sel.head);
  const r = view.dom.getBoundingClientRect();
  const left = Math.min((coords?.left ?? r.left) , window.innerWidth - PANEL_W - 12);
  panel.style.left = `${Math.max(12, left)}px`;
  panel.style.top = `${(coords?.bottom ?? r.top) + 6}px`;
  document.body.appendChild(panel);

  let phase: 'input' | 'loading' | 'review' = 'input';
  let pending: { from: number; len: number; originalText: string } | null = null;
  let input: HTMLInputElement;

  // --- @media mention autocomplete (images + videos, on the prompt input) ---
  let media: MentionMedia[] = [];
  void getMedia()
    .then((m) => {
      media = m;
      if (phase === 'input' && input) updateMention(); // a '@' typed before load resolves
    })
    .catch(() => {});
  let mentionBox: HTMLDivElement | null = null;
  let mentionItems: MentionMedia[] = [];
  let mentionIndex = 0;
  let mentionStart = -1;

  function closeMention() {
    mentionBox?.remove();
    mentionBox = null;
  }
  function updateMention() {
    const pos = input.selectionStart ?? input.value.length;
    const m = findMention(input.value.slice(0, pos));
    if (!m) return closeMention();
    mentionStart = m.start;
    mentionItems = filterMedia(media, m.query);
    if (!mentionItems.length) return closeMention();
    if (mentionIndex >= mentionItems.length) mentionIndex = 0;
    renderMention();
  }
  function renderMention() {
    if (!mentionBox) {
      mentionBox = el('div', {
        marginTop: '6px',
        maxHeight: '190px',
        overflowY: 'auto',
        border: '1px solid #34344a',
        borderRadius: '8px',
        background: '#0f0f1a',
      });
      input.after(mentionBox);
    }
    mentionBox.replaceChildren();
    mentionItems.forEach((im, i) => {
      const row = el('div', {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 8px',
        cursor: 'pointer',
        background: i === mentionIndex ? 'rgba(167,139,250,0.22)' : 'transparent',
      });
      const thumbStyle: Partial<CSSStyleDeclaration> = {
        width: '22px',
        height: '22px',
        objectFit: 'cover',
        borderRadius: '4px',
        background: '#222',
        flex: '0 0 auto',
      };
      // Slides and poster-less videos fall back to a glyph placeholder.
      let thumb: HTMLElement;
      if (im.thumbUrl) {
        const img = el('img', thumbStyle) as HTMLImageElement;
        img.src = im.thumbUrl;
        thumb = img;
      } else {
        thumb = el('span', {
          ...thumbStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: '#cfcfe6',
        }, im.kind === 'slide' ? '▤' : '▶');
      }
      const nameEl = el(
        'span',
        { fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto' },
        im.name,
      );
      row.append(thumb, nameEl);
      if (im.kind !== 'image') {
        row.append(
          el('span', { fontSize: '9px', color: '#8a8aa3', textTransform: 'uppercase', letterSpacing: '0.04em', flex: '0 0 auto' }, im.kind),
        );
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mentionIndex = i;
        acceptMention();
      });
      mentionBox!.append(row);
    });
  }
  function acceptMention() {
    const im = mentionItems[mentionIndex];
    if (!im) return closeMention();
    const pos = input.selectionStart ?? input.value.length;
    const { value, caret } = applyMention(input.value, pos, mentionStart, im.ref);
    input.value = value;
    input.setSelectionRange(caret, caret);
    closeMention();
    input.focus();
  }

  // --- ghost-text prompt autocomplete (grey continuation; Tab/→ accepts) ---
  let ghostText = '';
  let ghostEl: HTMLDivElement | null = null;
  let ghostTyped: HTMLSpanElement | null = null;
  let ghostSug: HTMLSpanElement | null = null;
  const ghost = createGhostCompleter({
    complete,
    getContext: () => ({ mode, code: view.state.doc.toString() }),
    onSuggestion: (text, forValue) => {
      if (input && input.value === forValue) setGhost(text);
    },
  });
  function setGhost(text: string) {
    ghostText = text;
    if (!ghostEl || !ghostTyped || !ghostSug) return;
    if (text) {
      ghostTyped.textContent = input.value;
      ghostSug.textContent = text;
      ghostEl.style.display = 'block';
      ghostEl.scrollLeft = input.scrollLeft;
    } else {
      ghostSug.textContent = '';
      ghostEl.style.display = 'none';
    }
  }
  function acceptGhost() {
    if (!ghostText) return;
    input.value = input.value + ghostText;
    setGhost('');
    ghost.cancel();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    input.focus();
  }
  function onPromptInput() {
    updateMention();
    setGhost(''); // any stale ghost is no longer valid
    const caret = input.selectionStart ?? input.value.length;
    const mentionActive = !!findMention(input.value.slice(0, caret));
    if (!mentionActive && caret === input.value.length) ghost.schedule(input.value);
    else ghost.cancel();
  }

  const close = () => {
    ghost.cancel();
    document.removeEventListener('mousedown', onOutside, true);
    panel.remove();
    view.focus();
  };
  const undoPending = () => {
    if (!pending) return;
    view.dispatch({
      changes: { from: pending.from, to: pending.from + pending.len, insert: pending.originalText },
      effects: clearPending.of(null),
    });
    pending = null;
  };
  const accept = () => {
    view.dispatch({ effects: clearPending.of(null) });
    close();
  };
  const reject = () => {
    undoPending();
    close();
  };

  const submit = async () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    ghost.cancel();
    setGhost('');
    phase = 'loading';
    renderLoading(prompt);
    let html: string;
    try {
      html = await generate({ mode, code: view.state.doc.toString(), selection, prompt });
    } catch (e) {
      phase = 'input';
      renderInput((e as Error).message || 'Generation failed');
      return;
    }
    const original = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: html },
      effects: setPending.of({ from, to: from + html.length }),
    });
    pending = { from, len: html.length, originalText: original };
    phase = 'review';
    renderReview(prompt);
  };
  const retry = (prompt: string) => {
    undoPending();
    phase = 'input';
    renderInput(undefined, prompt);
    input.focus();
    input.select();
  };

  // --- renderers ---
  function header(): HTMLElement {
    const h = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' });
    h.append(
      el('span', { color: '#a78bfa', fontWeight: '600' }, '✦'),
      el('span', { fontWeight: '600' }, 'Slides Intelligence'),
      el('span', { marginLeft: 'auto', fontSize: '11px', color: '#8a8aa3' }, mode === 'replace' ? 'edit selection' : 'whole slide'),
    );
    return h;
  }

  function renderInput(error?: string, value?: string) {
    panel.replaceChildren();
    mentionBox = null;
    ghostText = '';
    ghostEl = null;
    ghost.cancel();
    panel.append(header());
    input = el('input', {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      background: '#0f0f1a',
      border: '1px solid #34344a',
      borderRadius: '8px',
      color: '#ececf4',
      font: 'inherit',
      outline: 'none',
    }) as HTMLInputElement;
    input.placeholder =
      mode === 'replace' ? 'Change the selection to…' : 'Add or change anything — the AI places it…';
    if (value) input.value = value;
    input.addEventListener('input', onPromptInput);
    input.addEventListener('scroll', () => {
      if (ghostEl) ghostEl.scrollLeft = input.scrollLeft;
    });
    // Wrap the input so the grey ghost suggestion can be overlaid behind the caret.
    const inputWrap = el('div', { position: 'relative' });
    ghostEl = el('div', {
      position: 'absolute',
      inset: '0',
      zIndex: '1',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      padding: '8px 10px',
      border: '1px solid transparent',
      borderRadius: '8px',
      font: 'inherit',
      whiteSpace: 'pre',
      overflow: 'hidden',
      display: 'none',
    }) as HTMLDivElement;
    ghostTyped = el('span', { color: 'transparent' }) as HTMLSpanElement;
    ghostSug = el('span', { color: '#8a8aa3' }) as HTMLSpanElement;
    ghostEl.append(ghostTyped, ghostSug);
    inputWrap.append(input, ghostEl);
    panel.append(inputWrap);
    if (error) panel.append(el('div', { color: '#ff9aa6', fontSize: '11px', marginTop: '6px' }, error));
    panel.append(el('div', { color: '#8a8aa3', fontSize: '11px', marginTop: '8px' }, '⏎ generate · ⇥ accept suggestion · @ slide/image/video · esc cancel'));
    requestAnimationFrame(() => input.focus());
  }

  function renderLoading(prompt: string) {
    panel.replaceChildren();
    panel.append(header());
    panel.append(el('div', { color: '#cfcfe6' }, `✦ Generating…`));
    panel.append(el('div', { color: '#8a8aa3', fontSize: '11px', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, prompt));
  }

  function renderReview(prompt: string) {
    panel.replaceChildren();
    panel.append(header());
    panel.append(el('div', { color: '#8a8aa3', fontSize: '11px', marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, prompt));
    const row = el('div', { display: 'flex', gap: '8px' });
    const accBtn = el('button', btnStyle('#5fdc8c', '#06210f'), '✓ Accept');
    const retryBtn = el('button', btnStyle('#34344a', '#ececf4'), '↻ Retry');
    const rejBtn = el('button', btnStyle('#34344a', '#ff9aa6'), '✗ Discard');
    accBtn.onclick = accept;
    retryBtn.onclick = () => retry(prompt);
    rejBtn.onclick = reject;
    row.append(accBtn, retryBtn, rejBtn);
    panel.append(row);
    panel.append(el('div', { color: '#8a8aa3', fontSize: '11px', marginTop: '8px' }, '⌘⏎ accept · esc discard'));
  }

  function btnStyle(bg: string, fg: string): Partial<CSSStyleDeclaration> {
    return {
      flex: '1', padding: '7px 8px', border: '0', borderRadius: '7px',
      background: bg, color: fg, cursor: 'pointer', font: 'inherit', fontWeight: '600',
    };
  }

  panel.addEventListener('keydown', (e) => {
    if (mentionBox && phase === 'input') {
      const n = mentionItems.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIndex = (mentionIndex + 1) % n;
        return renderMention();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIndex = (mentionIndex - 1 + n) % n;
        return renderMention();
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return acceptMention();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return closeMention();
      }
    }
    // Ghost-text: Tab (or → at the end) accepts; Esc dismisses it before closing.
    if (ghostText && phase === 'input' && !mentionBox) {
      const atEnd =
        input.selectionStart === input.value.length && input.selectionStart === input.selectionEnd;
      if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) {
        e.preventDefault();
        return acceptGhost();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setGhost('');
        ghost.cancel();
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      phase === 'review' ? reject() : close();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      phase === 'review' ? accept() : void submit();
    } else if (e.key === 'Enter' && phase === 'input' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });

  function onOutside(e: MouseEvent) {
    if (panel.contains(e.target as Node)) return;
    if (phase === 'loading') return; // don't interrupt a running generation
    if (phase === 'review') accept(); // clicking away keeps the change
    else close();
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true));

  renderInput();
}

/** ⌘K inline "Slides Intelligence": prompt → generate → review (accept/discard) in place. */
export function slidesIntelligence(generate: SiGenerate, getMedia: SiGetMedia, complete: SiComplete) {
  return [
    pendingField,
    theme,
    keymap.of([
      {
        key: 'Mod-k',
        preventDefault: true,
        run: (view) => (openSi(view, generate, getMedia, complete), true),
      },
    ]),
  ];
}
