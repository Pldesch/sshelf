import fs from 'node:fs';
import crypto from 'node:crypto';

export function readRaw(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

export function hashContent(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Write via a temp file + rename so watchers never observe a half-written file. */
export function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}
