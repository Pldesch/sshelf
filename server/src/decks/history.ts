import fs from 'node:fs';
import path from 'node:path';
import type { Snapshot } from '@studio/shared';
import { REPO_ROOT } from '../config';
import { deckDir, htmlPath } from './paths';
import { readRaw, atomicWrite, hashContent } from '../deck/io';
import { HttpError } from '../errors';

// Snapshots live outside presentations/ so they never trip the deck file watcher
// and aren't served as deck assets.
const HISTORY_ROOT = path.join(REPO_ROOT, '.studio-history');
const MAX_SNAPSHOTS = 60;

interface StoredSnapshot extends Snapshot {
  hash: string;
}

// Process-monotonic counter so two snapshots in the same millisecond stay unique.
let seq = 0;

function historyDir(deckId: string): string {
  deckDir(deckId); // validates the id (throws on traversal)
  return path.join(HISTORY_ROOT, deckId);
}
function manifestPath(deckId: string): string {
  return path.join(historyDir(deckId), 'manifest.json');
}
function snapFile(deckId: string, id: string): string {
  return path.join(historyDir(deckId), `${id}.html`);
}

function readManifest(deckId: string): StoredSnapshot[] {
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath(deckId), 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function writeManifest(deckId: string, list: StoredSnapshot[]): void {
  atomicWrite(manifestPath(deckId), JSON.stringify(list, null, 2));
}

/**
 * Record the deck's state (the bytes *before* a change) as a restorable snapshot,
 * newest-first. Never throws — a history failure must never block an actual edit.
 */
export function recordHistory(deckId: string, content: string, label: string): void {
  try {
    fs.mkdirSync(historyDir(deckId), { recursive: true });
    const list = readManifest(deckId);
    const hash = hashContent(content);
    if (list.length && list[0].hash === hash) return; // unchanged since last snapshot
    const id = `${Date.now()}_${seq++}`;
    fs.writeFileSync(snapFile(deckId, id), content, 'utf8');
    list.unshift({ id, ts: Date.now(), label, size: content.length, hash });
    while (list.length > MAX_SNAPSHOTS) {
      const old = list.pop();
      if (old) {
        try {
          fs.rmSync(snapFile(deckId, old.id));
        } catch {
          /* best effort */
        }
      }
    }
    writeManifest(deckId, list);
  } catch (e) {
    console.error('[studio] history snapshot failed:', e);
  }
}

export function listHistory(deckId: string): Snapshot[] {
  return readManifest(deckId).map((s) => ({ id: s.id, ts: s.ts, label: s.label, size: s.size }));
}

/** Restore a snapshot. Records the current state first, so the restore is itself undoable. */
export function restoreHistory(deckId: string, id: string): string {
  if (!/^\d+_\d+$/.test(id)) throw new HttpError(400, 'Invalid snapshot id', 'INVALID_SNAPSHOT');
  const file = snapFile(deckId, id);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Snapshot not found', 'SNAPSHOT_NOT_FOUND');
  const content = fs.readFileSync(file, 'utf8');
  recordHistory(deckId, readRaw(htmlPath(deckId)), 'Before restore');
  atomicWrite(htmlPath(deckId), content);
  return hashContent(content);
}
