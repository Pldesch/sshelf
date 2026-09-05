import path from 'node:path';
import chokidar from 'chokidar';
import { PRESENTATIONS_DIR } from './config';
import type { WsHub } from './ws';

/**
 * Watch every deck directory and broadcast `deck-changed` for source, style,
 * and asset changes. Sshelf's embedded adapter uses the relative filename to
 * synchronize the modified file back to its workspace.
 */
export function startWatcher(hub: WsHub): void {
  const watcher = chokidar.watch(PRESENTATIONS_DIR, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    ignored: (p: string) => p.endsWith('.tmp'),
  });

  const onChange = (filePath: string, deleted = false) => {
    const rel = path.relative(PRESENTATIONS_DIR, filePath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) return;
    const deckId = parts[0];
    const file = parts.slice(1).join('/');
    if (
      file !== 'presentation.html' &&
      file !== 'styles.css' &&
      !file.startsWith('images/') &&
      !file.startsWith('videos/')
    ) return;
    hub.broadcast(deckId, { type: 'deck-changed', deckId, file, deleted });
  };

  watcher
    .on('add', (filePath) => onChange(filePath))
    .on('change', (filePath) => onChange(filePath))
    .on('unlink', (filePath) => onChange(filePath, true))
    .on('error', (err) => console.error('[studio] watcher error:', err));
}
