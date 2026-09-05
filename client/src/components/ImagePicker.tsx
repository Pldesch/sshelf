import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

/**
 * "Import images from a website": scrape a page for its images, preview them with their
 * pixel size, select the ones you want, and import them into the current deck's or theme's
 * assets. Each thumbnail is the real image loaded from the source site, so the dimensions
 * are the browser's natural size — no server-side image fetching needed to list them.
 */
export function ImagePicker() {
  const mode = useStudio((s) => s.mode);
  const currentDeckId = useStudio((s) => s.currentDeckId);
  const currentThemeId = useStudio((s) => s.currentThemeId);
  const initialUrl = useStudio((s) => s.imagePicker.url);
  const close = useStudio((s) => s.closeImagePicker);
  const showAssets = useStudio((s) => s.showAssets);
  const showToast = useStudio((s) => s.showToast);

  const [url, setUrl] = useState(initialUrl);
  const [images, setImages] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const target = mode === 'theme' ? currentThemeId : currentDeckId;

  const scan = async (u: string) => {
    const link = u.trim();
    if (!link || loading) return;
    setLoading(true);
    setError(null);
    setImages(null);
    setDims({});
    setBroken(new Set());
    setSelected(new Set());
    try {
      const { images: list } = await api.scrapeImages(link);
      setImages(list);
      if (list.length === 0) setError('No images found on that page.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-scan the URL the palette handed us; otherwise focus the URL bar.
  useEffect(() => {
    if (initialUrl.trim()) void scan(initialUrl);
    else urlRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (u: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(u) ? next.delete(u) : next.add(u);
      return next;
    });

  const visible = (images ?? []).filter((u) => !broken.has(u));

  const selectAll = () => setSelected(new Set(visible));
  const clear = () => setSelected(new Set());

  const doImport = async () => {
    if (!target || selected.size === 0 || importing) return;
    setImporting(true);
    const urls = [...selected];
    const results = await Promise.allSettled(
      urls.map((u) =>
        mode === 'theme'
          ? api.addThemeImageFromUrl(target, u)
          : api.addImageFromUrl(target, u),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    showAssets();
    close();
    showToast(
      failed ? 'info' : 'success',
      `Imported ${ok} image${ok === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`,
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !importing && close()}>
      <div
        className="modal image-picker"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !importing) close();
        }}
      >
        <div className="modal-head">
          <span className="modal-title">Import images from a website</span>
          <button className="icon-btn" title="Close" disabled={importing} onClick={close}>
            ×
          </button>
        </div>

        <div className="ip-urlbar">
          <input
            ref={urlRef}
            type="text"
            placeholder="Paste a website URL (https:// assumed)…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void scan(url)}
          />
          <button className="btn-sm" disabled={loading || !url.trim()} onClick={() => void scan(url)}>
            {loading ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        <div className="ip-grid">
          {loading ? (
            <div className="ip-empty">Scanning the page…</div>
          ) : error ? (
            <div className="ip-empty ip-error">{error}</div>
          ) : images === null ? (
            <div className="ip-empty">Enter a website URL and Scan to list its images.</div>
          ) : visible.length === 0 ? (
            <div className="ip-empty">No loadable images found.</div>
          ) : (
            visible.map((u) => {
              const d = dims[u];
              const sel = selected.has(u);
              return (
                <button
                  key={u}
                  className={`ip-card${sel ? ' selected' : ''}`}
                  title={u}
                  onClick={() => toggle(u)}
                >
                  <span className="ip-thumb">
                    <img
                      src={u}
                      alt=""
                      loading="lazy"
                      onLoad={(e) => {
                        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                        setDims((prev) => ({ ...prev, [u]: { w, h } }));
                      }}
                      onError={() => setBroken((prev) => new Set(prev).add(u))}
                    />
                    {sel && <span className="ip-check">✓</span>}
                  </span>
                  <span className="ip-meta">{d ? `${d.w}×${d.h}` : '…'}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="modal-foot ip-foot">
          <span className="ip-count">
            {visible.length > 0 && (
              <>
                {selected.size} of {visible.length} selected ·{' '}
                <button className="tp-link" onClick={selectAll}>
                  all
                </button>{' '}
                ·{' '}
                <button className="tp-link" onClick={clear}>
                  none
                </button>
              </>
            )}
          </span>
          <button
            className="primary"
            disabled={importing || selected.size === 0 || !target}
            onClick={() => void doImport()}
          >
            {importing
              ? 'Importing…'
              : `Import ${selected.size || ''} image${selected.size === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
