import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { css as cmCss } from '@codemirror/lang-css';
import { EditorView, keymap } from '@codemirror/view';
import { foldGutter, codeFolding, foldKeymap } from '@codemirror/language';
import { useStudio } from '../state/deckStore';
import { findClassRule } from '../lib/classJump';
import * as api from '../api/client';
import { ApiError } from '../api/client';

/**
 * Edits the deck's whole `styles.css` (the global stylesheet shared by every slide).
 * Mirrors the slide CodeEditor's debounced-autosave + optimistic-concurrency model,
 * but against the raw CSS file rather than a single slide. CSS edits are not part of
 * deck history (which tracks only the HTML), so there's no snapshot on save.
 */
export function StyleEditor() {
  const deckId = useStudio((s) => s.currentDeckId);
  const previewNonce = useStudio((s) => s.previewNonce);
  const styleJump = useStudio((s) => s.styleJump);
  const showToast = useStudio((s) => s.showToast);

  const [doc, setDoc] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const docRef = useRef('');
  const dirtyRef = useRef(false);
  const baseHashRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Which deck the buffer currently holds — guards the reconcile effect from acting
  // before the load for a freshly-selected deck has finished.
  const loadedDeckRef = useRef<string | null>(null);
  const appliedJumpRef = useRef(0);

  const setBuffer = (v: string) => {
    docRef.current = v;
    setDoc(v);
  };
  const markDirty = (d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  };

  // Full (re)load when the selected deck changes.
  useEffect(() => {
    loadedDeckRef.current = null;
    setLoaded(false);
    if (!deckId) return;
    let cancelled = false;
    api
      .getStylesRaw(deckId)
      .then(({ css, contentHash }) => {
        if (cancelled) return;
        setBuffer(css);
        baseHashRef.current = contentHash;
        loadedDeckRef.current = deckId;
        markDirty(false);
        setConflict(false);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) showToast('error', (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, showToast]);

  const save = useCallback(async () => {
    if (!deckId || !dirtyRef.current || saving) return;
    setSaving(true);
    try {
      const { contentHash } = await api.putStylesRaw(deckId, docRef.current, baseHashRef.current);
      baseHashRef.current = contentHash;
      markDirty(false);
      setConflict(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else showToast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [deckId, saving, showToast]);

  const onChange = (val: string) => {
    setBuffer(val);
    markDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 800);
  };

  // Reconcile when styles.css changes on disk (watcher → previewNonce). Adopt the new
  // bytes when we have no unsaved edits; flag a conflict otherwise. Skipped until the
  // current deck's content has loaded so a deck switch can't trip a false conflict.
  useEffect(() => {
    if (!deckId || loadedDeckRef.current !== deckId) return;
    let cancelled = false;
    api
      .getStylesRaw(deckId)
      .then(({ css, contentHash }) => {
        if (cancelled || loadedDeckRef.current !== deckId) return;
        if (contentHash === baseHashRef.current) return; // our own save, or nothing changed
        if (!dirtyRef.current) {
          setBuffer(css);
          baseHashRef.current = contentHash;
          setConflict(false);
        } else if (css !== docRef.current) {
          setConflict(true);
        }
      })
      .catch(() => {
        /* transient — leave the buffer as-is */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewNonce]);

  const reloadFromDisk = useCallback(async () => {
    if (!deckId) return;
    try {
      const { css, contentHash } = await api.getStylesRaw(deckId);
      setBuffer(css);
      baseHashRef.current = contentHash;
      markDirty(false);
      setConflict(false);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }, [deckId, showToast]);

  // Go-to-definition: ⌘-clicking a class in the slide editor sets styleJump; scroll
  // the matching rule into view and select it. Waits for the content to load.
  useEffect(() => {
    if (!styleJump || !loaded || styleJump.nonce === appliedJumpRef.current) return;
    const view = viewRef.current;
    if (!view) return;
    appliedJumpRef.current = styleJump.nonce;
    const hit = findClassRule(docRef.current, styleJump.selector);
    if (!hit) {
      showToast('info', `.${styleJump.selector} is not defined in styles.css`);
      return;
    }
    view.focus();
    view.dispatch({
      selection: { anchor: hit.from, head: hit.to },
      effects: EditorView.scrollIntoView(hit.from, { y: 'center' }),
    });
  }, [styleJump, loaded, showToast]);

  const extensions = useMemo(
    () => [cmCss(), codeFolding(), foldGutter(), keymap.of(foldKeymap), EditorView.lineWrapping],
    [],
  );

  if (!deckId) return <div className="panel-empty">No deck open.</div>;

  const status = saving ? 'Saving…' : conflict ? 'Conflict' : dirty ? 'Unsaved' : 'Saved';

  return (
    <div className="code-editor">
      <div className="code-head">
        <span className="code-id">styles.css</span>
        <span className={`code-status ${status.toLowerCase().replace('…', '')}`}>{status}</span>
        <button className="btn-sm" disabled={!dirty || saving} onClick={() => void save()}>
          Save
        </button>
      </div>
      {conflict && (
        <div className="banner warn">
          styles.css changed on disk.
          <button className="btn-sm" onClick={() => void reloadFromDisk()}>
            Reload from disk
          </button>
        </div>
      )}
      <div
        className="code-wrap"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void save();
          }
        }}
      >
        <CodeMirror
          value={doc}
          theme="dark"
          height="100%"
          className="cm-fill"
          extensions={extensions}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            closeBrackets: true,
            autocompletion: true,
          }}
        />
      </div>
      <p className="code-hint">The whole deck stylesheet · ⌘/Ctrl-S to save · ⌘-click a class in Code to jump here</p>
    </div>
  );
}
