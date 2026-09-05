import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { ImageInfo, VideoInfo } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import * as api from '../api/client';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The reveal-ready styled embed for a downloaded video, used by the "copy" action. */
function videoSnippet(v: VideoInfo): string {
  const poster = v.poster ? ` poster="${v.poster}"` : '';
  return `<div class="video-embed">\n  <video data-autoplay controls playsinline src="${v.ref}"${poster}></video>\n</div>`;
}

/**
 * Deck-level media library: images (upload / drop / from-URL) and videos
 * (downloaded from YouTube et al. via the server's yt-dlp). Both are stored in the
 * deck folder and referenced from slides.
 */
export function AssetsPanel() {
  const deckId = useStudio((s) => s.currentDeckId);
  const model = useStudio((s) => s.model);
  const selectedKey = useStudio((s) => s.selectedKey);
  const assetsNonce = useStudio((s) => s.assetsNonce);
  const showToast = useStudio((s) => s.showToast);

  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [videos, setVideos] = useState<VideoInfo[] | null>(null);
  const [imgUrl, setImgUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshImages = useCallback(async () => {
    if (!deckId) return;
    try {
      const { images: list } = await api.listImages(deckId);
      setImages(list);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }, [deckId, showToast]);

  const refreshVideos = useCallback(async () => {
    if (!deckId) return;
    try {
      const { videos: list } = await api.listVideos(deckId);
      setVideos(list);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }, [deckId, showToast]);

  useEffect(() => {
    setImages(null);
    setVideos(null);
    void refreshImages();
    void refreshVideos();
  }, [refreshImages, refreshVideos, assetsNonce]);

  if (!deckId) return <div className="panel-empty">No deck open.</div>;

  // --- Images ---
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || IMAGE_RE.test(f.name),
    );
    if (list.length === 0) {
      showToast('error', 'No image files in that drop');
      return;
    }
    setBusy(true);
    try {
      for (const f of list) await api.uploadImage(deckId, f, f.name);
      showToast('success', `Added ${list.length} image${list.length > 1 ? 's' : ''}`);
      await refreshImages();
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
      const img = await api.addImageFromUrl(deckId, u);
      setImgUrl('');
      showToast('success', `Downloaded ${img.name}`);
      await refreshImages();
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // --- Videos ---
  const addVideo = async () => {
    const u = videoUrl.trim();
    if (!u) return;
    setDownloading(true);
    try {
      const v = await api.downloadVideo(deckId, u);
      setVideoUrl('');
      showToast('success', `Downloaded ${v.name}`);
      await refreshVideos();
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

  const setImageBackground = async (img: ImageInfo) => {
    if (!model || !selectedKey) {
      showToast('error', 'Select a slide first');
      return;
    }
    try {
      await api.patchSection(
        deckId,
        selectedKey,
        { 'data-background-image': img.ref, 'data-background-color': null },
        model.contentHash,
      );
      showToast('success', 'Set as background of the selected slide');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const setVideoBackground = async (v: VideoInfo) => {
    if (!model || !selectedKey) {
      showToast('error', 'Select a slide first');
      return;
    }
    try {
      await api.patchSection(
        deckId,
        selectedKey,
        { 'data-background-video': v.ref, 'data-background-color': null },
        model.contentHash,
      );
      showToast('success', 'Set as background video of the selected slide');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const removeImage = async (img: ImageInfo) => {
    if (!confirm(`Delete ${img.name}? Slides that reference it will show a broken image.`)) return;
    try {
      await api.deleteImage(deckId, img.name);
      await refreshImages();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const removeVideo = async (v: VideoInfo) => {
    if (!confirm(`Delete ${v.name}? Slides that reference it will show a broken video.`)) return;
    try {
      await api.deleteVideo(deckId, v.name);
      await refreshVideos();
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

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
        <button
          className="btn-sm"
          disabled={downloading || !videoUrl.trim()}
          onClick={() => void addVideo()}
        >
          {downloading ? 'Downloading…' : 'Add video'}
        </button>
      </div>
      {downloading && <div className="asset-note">Downloading & transcoding — this can take a minute.</div>}

      {/* Videos */}
      <div className="asset-section">Videos</div>
      {videos === null ? (
        <div className="panel-empty">Loading videos…</div>
      ) : videos.length === 0 ? (
        <div className="img-empty">No videos yet. Paste a YouTube URL above to download one.</div>
      ) : (
        <div className="video-grid">
          {videos.map((v) => (
            <div className="video-card" key={v.name}>
              <a
                className="video-thumb"
                href={v.url}
                target="_blank"
                rel="noreferrer"
                style={v.posterUrl ? { backgroundImage: `url("${v.posterUrl}")` } : undefined}
                title={`${v.name} — open`}
              >
                <span className="video-play">▶</span>
              </a>
              <div className="img-meta">
                <span className="img-name" title={v.name}>
                  {v.name}
                </span>
                <span className="img-size">{fmtSize(v.size)}</span>
              </div>
              <div className="img-actions">
                <button
                  className="btn-sm"
                  title="Set as background video of the selected slide"
                  onClick={() => void setVideoBackground(v)}
                >
                  ⬚ Background
                </button>
                <button
                  className="btn-sm"
                  title="Copy a styled <video> embed to paste in the Code tab"
                  onClick={() => void copy(videoSnippet(v), 'Copied <video> embed')}
                >
                  &lt;video&gt;
                </button>
                <button
                  className="btn-sm"
                  title="Copy the path to reference it manually"
                  onClick={() => void copy(v.ref, `Copied "${v.ref}"`)}
                >
                  ⧉ path
                </button>
                <button className="btn-sm danger" title="Delete video" onClick={() => void removeVideo(v)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Images */}
      <div className="asset-section">Images</div>
      {images === null ? (
        <div className="panel-empty">Loading images…</div>
      ) : images.length === 0 ? (
        <div className="img-empty">
          No images yet. Drop files here, choose files, or download from a URL.
        </div>
      ) : (
        <div className="img-grid">
          {images.map((img) => (
            <div className="img-card" key={img.name}>
              <a
                className="img-thumb"
                href={img.url}
                target="_blank"
                rel="noreferrer"
                style={{ backgroundImage: `url("${img.url}")` }}
                title={`${img.name} — open full size`}
              />
              <div className="img-meta">
                <span className="img-name" title={img.name}>
                  {img.name}
                </span>
                <span className="img-size">{fmtSize(img.size)}</span>
              </div>
              <div className="img-actions">
                <button
                  className="btn-sm"
                  title="Set as background of the selected slide"
                  onClick={() => void setImageBackground(img)}
                >
                  ⬚ Background
                </button>
                <button
                  className="btn-sm"
                  title="Copy an &lt;img&gt; tag to paste in the Code tab"
                  onClick={() => void copy(`<img src="${img.ref}" alt="" />`, 'Copied <img> tag')}
                >
                  &lt;img&gt;
                </button>
                <button
                  className="btn-sm"
                  title="Copy the path to reference it manually"
                  onClick={() => void copy(img.ref, `Copied "${img.ref}"`)}
                >
                  ⧉ path
                </button>
                <button
                  className="btn-sm danger"
                  title="Delete image"
                  onClick={() => void removeImage(img)}
                >
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
