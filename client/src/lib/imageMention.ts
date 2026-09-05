import type { ImageInfo, VideoInfo, Slide } from '@studio/shared';

// A trailing "@query" token in the text before the caret (filenames allow . _ -).
const MENTION_RE = /@([\w.\-]*)$/;

/** A deck asset/slide that can be @-mentioned in a Slides Intelligence / agent prompt. */
export interface MentionMedia {
  name: string;
  /** What gets inserted to reference it: images/foo.png, videos/bar.mp4, or #slide-id. */
  ref: string;
  /** A still to show in the menu (image url, or a video's poster). */
  thumbUrl?: string;
  kind: 'image' | 'video' | 'slide';
}

/** Merge the deck's slides, images, and videos into one @-mention list. */
export function toMentionMedia(
  images: ImageInfo[],
  videos: VideoInfo[],
  slides: Slide[] = [],
): MentionMedia[] {
  return [
    ...slides.map((s): MentionMedia => ({
      name: s.title || s.id || s.key,
      ref: `#${s.id || s.key}`,
      kind: 'slide',
    })),
    ...images.map((i): MentionMedia => ({ name: i.name, ref: i.ref, thumbUrl: i.url, kind: 'image' })),
    ...videos.map((v): MentionMedia => ({ name: v.name, ref: v.ref, thumbUrl: v.posterUrl, kind: 'video' })),
  ];
}

/** Find an active @-mention token immediately before the caret, or null. */
export function findMention(textBeforeCaret: string): { start: number; query: string } | null {
  const m = MENTION_RE.exec(textBeforeCaret);
  return m ? { start: textBeforeCaret.length - m[0].length, query: m[1] } : null;
}

/** Media whose name or ref contains the query (case-insensitive), capped. The ref match
 *  lets a slide be found by its #id as well as its title. */
export function filterMedia(items: MentionMedia[], query: string, limit = 10): MentionMedia[] {
  const q = query.toLowerCase();
  if (!q) return items.slice(0, limit);
  return items
    .filter((m) => m.name.toLowerCase().includes(q) || m.ref.toLowerCase().includes(q))
    .slice(0, limit);
}

/** Replace the @query (at `start`..`caret`) with the image ref + trailing space. */
export function applyMention(
  value: string,
  caret: number,
  start: number,
  ref: string,
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const insert = ref + ' ';
  return { value: before + insert + value.slice(caret), caret: before.length + insert.length };
}
