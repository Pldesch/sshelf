import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html as cmHtml } from '@codemirror/lang-html';
import { EditorView, keymap } from '@codemirror/view';
import { foldGutter, codeFolding, foldKeymap } from '@codemirror/language';
import type { CssVar } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import { findSlide } from '../lib/locate';
import { elementPathAt, offsetForPath } from '../lib/codeHover';
import { classTokenAt, classLinkHighlighter } from '../lib/classJump';
import { toMentionMedia } from '../lib/imageMention';
import { makeBrandCompletionSource, extractDeckClasses, type CompletionData } from '../lib/cmComplete';
import { colorSwatches, refreshSwatches } from '../lib/cmColor';
import { imageThumbs, type ImageAsset } from '../lib/cmImage';
import { numberScrubber } from '../lib/cmScrub';
import { slidesIntelligence, type SiGenerateReq } from '../lib/cmIntelligence';
import { SiDock, type SiSelection } from './SiDock';
import { highlightPath, clearPreviewHighlight } from '../lib/previewHighlight';
import * as api from '../api/client';
import { ApiError } from '../api/client';

export function CodeEditor() {
  const model = useStudio((s) => s.model);
  const selectedKey = useStudio((s) => s.selectedKey);
  const deckId = useStudio((s) => s.currentDeckId);
  const showToast = useStudio((s) => s.showToast);
  const codeJump = useStudio((s) => s.codeJump);

  const slide = model && selectedKey ? findSlide(model, selectedKey) : null;

  const [doc, setDoc] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [siSel, setSiSel] = useState<SiSelection | null>(null);

  const docRef = useRef('');
  const dirtyRef = useRef(false);
  const baseHashRef = useRef('');
  const loadedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeRef = useRef<CompletionData>({ classes: [], cssVars: [] });
  const viewRef = useRef<EditorView | null>(null);
  const appliedJumpRef = useRef(-1);

  // Load the deck's real classes (from styles.css) and CSS variables for brand-aware
  // autocompletion and color swatches in the editor.
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/decks/${deckId}/styles.css`).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
      api.getStyles(deckId).catch(() => [] as CssVar[]),
    ]).then(([css, cssVars]) => {
      if (cancelled) return;
      completeRef.current = { classes: extractDeckClasses(css), cssVars };
      viewRef.current?.dispatch({ effects: refreshSwatches.of(null) }); // draw var(--brand) swatches
    });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const setBuffer = (v: string) => {
    docRef.current = v;
    setDoc(v);
  };
  const markDirty = (d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  };

  // Load a slide's source when selection changes.
  useEffect(() => {
    if (!slide || !model) return;
    setBuffer(slide.rawHtml);
    baseHashRef.current = model.contentHash;
    markDirty(false);
    setConflict(false);
    loadedKeyRef.current = selectedKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Reconcile when the deck model refreshes (our own save, or an agent edit).
  useEffect(() => {
    if (!slide || !model || loadedKeyRef.current !== selectedKey) return;
    if (model.contentHash === baseHashRef.current) return;
    if (!dirtyRef.current) {
      setBuffer(slide.rawHtml);
      baseHashRef.current = model.contentHash;
      setConflict(false);
    } else if (slide.rawHtml !== docRef.current) {
      setConflict(true);
    } else {
      baseHashRef.current = model.contentHash;
      markDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Alt-click in the preview lands here: once the target slide is loaded into the editor,
  // place the cursor on the matching source element and scroll it into view.
  useEffect(() => {
    if (!codeJump || codeJump.nonce === appliedJumpRef.current) return;
    if (!slide || codeJump.key !== selectedKey) return; // target slide not selected yet
    const view = viewRef.current;
    if (!view || docRef.current !== slide.rawHtml) return; // editor hasn't applied it yet
    appliedJumpRef.current = codeJump.nonce; // consume once (even if the path doesn't resolve)
    const offset = offsetForPath(view, codeJump.path);
    if (offset == null) return;
    view.focus();
    view.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: 'center' }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeJump, selectedKey, doc]);

  const save = useCallback(async () => {
    if (!deckId || !selectedKey || !dirtyRef.current || saving) return;
    setSaving(true);
    try {
      const { contentHash } = await api.putSlide(
        deckId,
        selectedKey,
        docRef.current,
        baseHashRef.current,
      );
      baseHashRef.current = contentHash;
      markDirty(false);
      setConflict(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else showToast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [deckId, selectedKey, saving, showToast]);

  const onChange = (val: string) => {
    setBuffer(val);
    markDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 800);
  };

  // Pretty-print the slide (server-side Prettier) and write it back through the
  // normal edit path (the dispatch fires onChange → dirty → autosave).
  const format = useCallback(async () => {
    const view = viewRef.current;
    if (!deckId || !view || formatting) return;
    setFormatting(true);
    try {
      const current = view.state.doc.toString();
      const { html } = await api.formatSlide(deckId, current);
      if (html && html !== current) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: html } });
      }
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setFormatting(false);
    }
  }, [deckId, formatting, showToast]);

  const reloadFromDisk = () => {
    if (!slide || !model) return;
    setBuffer(slide.rawHtml);
    baseHashRef.current = model.contentHash;
    markDirty(false);
    setConflict(false);
  };

  // Hovering a code element outlines the matching element in the preview.
  const hoverExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        mousemove(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return;
          const info = elementPathAt(view, pos);
          if (!info) {
            clearPreviewHighlight();
            return;
          }
          const { model: m, selectedKey: k } = useStudio.getState();
          if (m && k) highlightPath(m, k, info.path, info.from);
        },
        mouseleave() {
          clearPreviewHighlight();
        },
      }),
    [],
  );

  // ⌘/Ctrl-click a class name that's defined in styles.css → jump to its rule in the
  // Styles tab. Only defined deck classes are treated as targets, so plain clicks and
  // clicks on reveal/utility classes keep their normal behaviour.
  const jumpExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const tok = classTokenAt(view, pos);
          if (!tok || !completeRef.current.classes.includes(tok.name)) return false;
          event.preventDefault();
          useStudio.getState().jumpToStyle(tok.name);
          return true;
        },
      }),
    [],
  );

  // ⌘/Ctrl-hover affordance: underline + pointer cursor over a jumpable class.
  const linkHighlighter = useMemo(() => classLinkHighlighter(() => completeRef.current.classes), []);

  // ⌘K Slides Intelligence: read the live deck/slide from the store at call time so the
  // memoized extension stays stable.
  const generateSi = useCallback(async (req: SiGenerateReq) => {
    const { currentDeckId } = useStudio.getState();
    if (!currentDeckId) throw new Error('No deck selected');
    const { html } = await api.generateSi(currentDeckId, req);
    return html;
  }, []);
  const getSiMedia = useCallback(async () => {
    const { currentDeckId, model: m } = useStudio.getState();
    if (!currentDeckId) return [];
    const [images, videos] = await Promise.all([
      api.listImages(currentDeckId).then((r) => r.images).catch(() => []),
      api.listVideos(currentDeckId).then((r) => r.videos).catch(() => []),
    ]);
    return toMentionMedia(images, videos, m?.slides ?? []);
  }, []);

  // Inline image-swap thumbnails: a deck src is `images/foo.png` served at /decks/<id>/…;
  // remote/data/absolute URLs are shown as-is.
  const resolveImgUrl = useCallback((value: string): string | null => {
    if (!value) return null;
    if (/^(data:|https?:|\/\/|\/)/i.test(value)) return value;
    const id = useStudio.getState().currentDeckId;
    return id ? `/decks/${id}/${value}` : null;
  }, []);
  const listImgAssets = useCallback(async (): Promise<ImageAsset[]> => {
    const id = useStudio.getState().currentDeckId;
    if (!id) return [];
    const { images } = await api.listImages(id);
    return images.map((i) => ({ name: i.name, url: i.url, ref: i.ref }));
  }, []);

  // HTML language + brand-aware completion (deck classes, CSS vars, reveal data-*).
  const editorExtensions = useMemo(() => {
    const lang = cmHtml({ autoCloseTags: false });
    return [
      lang,
      lang.language.data.of({ autocomplete: makeBrandCompletionSource(() => completeRef.current) }),
      colorSwatches(() => completeRef.current.cssVars),
      imageThumbs({ resolveUrl: resolveImgUrl, listAssets: listImgAssets }),
      numberScrubber(),
      slidesIntelligence(generateSi, getSiMedia, async (req, signal) => {
        const id = useStudio.getState().currentDeckId;
        if (!id) return '';
        const { completion } = await api.suggestSiCompletion(id, req, signal);
        return completion ?? '';
      }),
      codeFolding(),
      foldGutter(),
      keymap.of(foldKeymap),
      // Keep the docked SI panel in sync with the editor's current selection.
      EditorView.updateListener.of((u) => {
        if (!u.selectionSet && !u.docChanged) return;
        const s = u.state.selection.main;
        if (s.empty) {
          setSiSel(null);
        } else {
          setSiSel({
            from: s.from,
            to: s.to,
            text: u.state.sliceDoc(s.from, s.to),
            fromLine: u.state.doc.lineAt(s.from).number,
            toLine: u.state.doc.lineAt(s.to).number,
          });
        }
      }),
      EditorView.lineWrapping,
      hoverExtension,
      jumpExtension,
      linkHighlighter,
    ];
  }, [hoverExtension, jumpExtension, linkHighlighter, generateSi, getSiMedia, resolveImgUrl, listImgAssets]);

  // Clear the preview outline when the slide changes or the panel unmounts.
  useEffect(() => clearPreviewHighlight, [selectedKey]);

  if (!slide) {
    return <div className="panel-empty">Select a slide to view its code.</div>;
  }

  const status = saving ? 'Saving…' : conflict ? 'Conflict' : dirty ? 'Unsaved' : 'Saved';

  return (
    <div className="code-editor">
      <div className="code-head">
        <span className="code-id">{slide.id ? `#${slide.id}` : slide.key}</span>
        <span className={`code-status ${status.toLowerCase().replace('…', '')}`}>{status}</span>
        <button
          className="btn-sm"
          disabled={formatting}
          onClick={() => void format()}
          title="Pretty-print this slide's HTML"
        >
          {formatting ? 'Formatting…' : 'Format'}
        </button>
        <button className="btn-sm" disabled={!dirty || saving} onClick={() => void save()}>
          Save
        </button>
      </div>
      {conflict && (
        <div className="banner warn">
          This slide changed on disk.
          <button className="btn-sm" onClick={reloadFromDisk}>
            Reload from disk
          </button>
        </div>
      )}
      <div
        className="code-wrap"
        onMouseLeave={() => clearPreviewHighlight()}
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
          extensions={editorExtensions}
          onCreateEditor={(view) => {
            viewRef.current = view;
            setEditorView(view);
          }}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            closeBrackets: false,
            autocompletion: true,
          }}
        />
      </div>
      <SiDock
        deckId={deckId ?? ''}
        view={editorView}
        sel={siSel}
        generate={generateSi}
        onError={(msg) => showToast('error', msg)}
      />
      <p className="code-hint">✦ ⌘K floats it too · ⌘/Ctrl-S to save · ⌥-drag a number to adjust · ⌘-click a class → styles.css</p>
    </div>
  );
}
