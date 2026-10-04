import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { writeRemoteFile } from "@/server/ssh"

interface Segment {
  at: Date
  text: string
}

export const hhmmss = (d: Date) => d.toTimeString().slice(0, 8)

/**
 * Meeting transcript kept in memory, appended to a local backup file, and
 * mirrored to a Markdown file in the Sshelf workspace after every segment.
 * Remote writes are serialized; if SSH is down the next segment retries.
 */
export class Transcript {
  readonly segments: Array<Segment> = []
  readonly remotePath: string
  readonly localPath: string
  private readonly header: string
  private syncing: Promise<void> | null = null
  private dirty = false
  lastSyncError: string | null = null

  constructor(remoteDir: string, localDir: string, title?: string) {
    const started = new Date()
    const stamp = started
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replace(/:/g, "-")
    this.header = `# ${title ?? "Meeting"}\n\n_${started.toLocaleString()}_\n\n`
    this.remotePath = `${remoteDir.replace(/\/+$/, "")}/${stamp}.md`
    mkdirSync(localDir, { recursive: true })
    this.localPath = join(localDir, `${stamp}.md`)
    appendFileSync(this.localPath, this.header)
  }

  add(text: string): Segment {
    const seg = { at: new Date(), text }
    this.segments.push(seg)
    appendFileSync(this.localPath, `[${hhmmss(seg.at)}] ${text}\n`)
    void this.sync()
    return seg
  }

  format(): string {
    return this.segments.map((s) => `[${hhmmss(s.at)}] ${s.text}`).join("\n")
  }

  /** Push the whole transcript to the workspace; coalesces overlapping calls. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.dirty = true
      return this.syncing
    }
    this.syncing = (async () => {
      do {
        this.dirty = false
        const body = this.header + this.format().replace(/\n/g, "\n\n") + "\n"
        try {
          await writeRemoteFile(this.remotePath, Buffer.from(body, "utf-8"))
          this.lastSyncError = null
        } catch (error) {
          this.lastSyncError = (error as Error).message
        }
        // `add()` can set `dirty` while the write above is in flight.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } while (this.dirty)
      this.syncing = null
    })()
    return this.syncing
  }
}
