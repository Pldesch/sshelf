import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { ThemeAsset } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function videoSnippet(a: ThemeAsset): string {
  const poster = a.posterUrl ? ` poster="assets/${a.posterUrl.split('/').pop()}"` : '';
  return `<div class="video-embed">\n  <video data-autoplay controls playsinline src="${a.ref}"${poster}></video>\n</div>`;
}

/**
 * Theme media library: images (upload / drop / from-URL) and videos (downloaded via the
 * server's yt-dlp) stored in the theme's assets/ folder. Theme slides reference them as
 * `assets/NAME`; on insert into a deck the referenced files are copied across.
 */
export function ThemeAssetsPanel() {
  const themeId = useStudio((s) => s.currentThemeId);
  const assetsNonce = useStudio((s) => s.assetsNonce);
  const showToast = useStudio((s) => s.showToast);

  const [assets, setAssets] = useState<ThemeAsset[] | null>(null);
  const [imgUrl, setImgUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!themeId) return;
    try {
      const { assets: list } = await api.listThemeAssets(themeId);
      setAssets(list);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }, [themeId, showToast]);

  useEffect(() => {
    setAssets(null);
    void refresh();
  }, [refresh, assetsNonce]);

  if (!themeId) return <div className="panel-empty">No theme open.</div>;

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || IMAGE_RE.test(f.name));
    if (list.length === 0) {
      showToast('error', 'No image files in that drop');
      return;
    }
    setBusy(true);
    try {
      for (const f of list) await api.uploadThemeImage(themeId, f, f.name);
      showToast('success', `Added ${list.length} image${list.length > 1 ? 's' : ''}`);
      await refresh();
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadImage = async () => {
    const u = imgUrl.trim();
    if (!u) return;
    setBusy(true);
    try {
      const a = await api.addThemeImageFromUrl(themeId, u);
      setImgUrl('');
      showToast('success', `Downloaded ${a.name}`);
      await refresh();
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addVideo = async () => {
    const u = videoUrl.trim();
    if (!u) return;
    setDownloading(true);
    try {
      const a = await api.downloadThemeVideo(themeId, u);
      setVideoUrl('');
      showToast('success', `Downloaded ${a.name}`);
      await refresh();
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', label);
    } catch {
      showToast('error', 'Could not copy to clipboard');
    }
  };

  const remove = async (a: ThemeAsset) => {
    if (!confirm(`Delete ${a.name}? Theme slides that reference it will break.`)) return;
    try {
      await api.deleteThemeAsset(themeId, a.name);
      await refresh();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

  const videos = (assets ?? []).filter((a) => a.kind === 'video');
  const images = (assets ?? []).filter((a) => a.kind === 'image');

  return (
    <div
      className={`asset-panel${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="img-add">
        <button className="btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          ＋ Choose images
        </button>
        <span className="img-hint">or drop images anywhere in this panel</span>
      </div>

      <div className="img-url-row">
        <input
          type="url"
          placeholder="Paste an image URL to download…"
          value={imgUrl}
          onChange={(e) => setImgUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && downloadImage()}
        />
        <button className="btn-sm" disabled={busy || !imgUrl.trim()} onClick={() => void downloadImage()}>
          Add image
        </button>
      </div>

      <div className="img-url-row">
        <input
          type="url"
          placeholder="Paste a YouTube or video URL…"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !downloading && addVideo()}
        />
        <button className="btn-sm" disabled={downloading || !videoUrl.trim()} onClick={() => void addVideo()}>
          {downloading ? 'Downloading…' : 'Add video'}
        </button>
      </div>
      {downloading && <div className="asset-note">Downloading & transcoding — this can take a minute.</div>}

      <div className="asset-section">Videos</div>
      {assets === null ? (
        <div className="panel-empty">Loading…</div>
      ) : videos.length === 0 ? (
        <div className="img-empty">No videos yet. Paste a video URL above to download one.</div>
      ) : (
        <div className="video-grid">
          {videos.map((a) => (
            <div className="video-card" key={a.name}>
              <a
                className="video-thumb"
                href={a.url}
                target="_blank"
                rel="noreferrer"
                style={a.posterUrl ? { backgroundImage: `url("${a.posterUrl}")` } : undefined}
                title={`${a.name} — open`}
              >
                <span className="video-play">▶</span>
              </a>
              <div className="img-meta">
                <span className="img-name" title={a.name}>
                  {a.name}
                </span>
                <span className="img-size">{fmtSize(a.size)}</span>
              </div>
              <div className="img-actions">
                <button
                  className="btn-sm"
                  title="Copy a styled <video> embed to paste in the template"
                  onClick={() => void copy(videoSnippet(a), 'Copied <video> embed')}
                >
                  &lt;video&gt;
                </button>
                <button className="btn-sm" title="Copy the assets/ path" onClick={() => void copy(a.ref, `Copied "${a.ref}"`)}>
                  ⧉ path
                </button>
                <a className="btn-sm" href={a.url} download={a.name} title="Download to your computer">
                  ⤓
                </a>
                <button className="btn-sm danger" title="Delete" onClick={() => void remove(a)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="asset-section">Images</div>
      {assets === null ? (
        <div className="panel-empty">Loading…</div>
      ) : images.length === 0 ? (
        <div className="img-empty">No images yet. Drop files here, choose files, or download from a URL.</div>
      ) : (
        <div className="img-grid">
          {images.map((a) => (
            <div className="img-card" key={a.name}>
              <a
                className="img-thumb"
                href={a.url}
                target="_blank"
                rel="noreferrer"
                style={{ backgroundImage: `url("${a.url}")` }}
                title={`${a.name} — open full size`}
              />
              <div className="img-meta">
                <span className="img-name" title={a.name}>
                  {a.name}
                </span>
                <span className="img-size">{fmtSize(a.size)}</span>
              </div>
              <div className="img-actions">
                <button
                  className="btn-sm"
                  title="Copy an <img> tag to paste in the template"
                  onClick={() => void copy(`<img src="${a.ref}" alt="" />`, 'Copied <img> tag')}
                >
                  &lt;img&gt;
                </button>
                <button className="btn-sm" title="Copy the assets/ path" onClick={() => void copy(a.ref, `Copied "${a.ref}"`)}>
                  ⧉ path
                </button>
                <a className="btn-sm" href={a.url} download={a.name} title="Download to your computer">
                  ⤓
                </a>
                <button className="btn-sm danger" title="Delete" onClick={() => void remove(a)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {dragOver && <div className="img-drop-overlay">Drop images to add them</div>}
    </div>
  );
}
