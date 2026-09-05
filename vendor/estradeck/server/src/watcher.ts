import path from 'node:path';
import chokidar from 'chokidar';
import { PRESENTATIONS_DIR, DECK_HTML_FILE, DECK_STYLES_FILE } from './config';
import type { WsHub } from './ws';

/**
 * Watch every deck directory and broadcast `deck-changed` when its html/css
 * changes — the single reload trigger for both human edits and agent edits.
 */
export function startWatcher(hub: WsHub): void {
  const watcher = chokidar.watch(PRESENTATIONS_DIR, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    ignored: (p: string) => p.endsWith('.tmp'),
  });

  const onChange = (filePath: string) => {
    const rel = path.relative(PRESENTATIONS_DIR, filePath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) return;
    const deckId = parts[0];
    const base = parts[parts.length - 1];
    if (base !== DECK_HTML_FILE && base !== DECK_STYLES_FILE) return;
    hub.broadcast(deckId, { type: 'deck-changed', deckId, file: base });
  };

  watcher
    .on('add', onChange)
    .on('change', onChange)
    .on('unlink', onChange)
    .on('error', (err) => console.error('[studio] watcher error:', err));
}
