export interface CyrusService {
  cyrus: string
  ngrok: string
  api: string
}

export interface CyrusSession {
  issue: string
  updatedAt: number
  lastStep: string
}

/** One `git worktree` under `~/.cyrus/worktrees`, before PR info is merged in. */
export interface CyrusWorktreeRaw {
  name: string
  path: string
  branch: string
  dirty: number
  sizeBytes: number
  repoPath: string
  origin: string | null
  active: boolean
}

export interface ParsedCyrusOverview {
  service: CyrusService
  sessions: Array<CyrusSession>
  worktrees: Array<CyrusWorktreeRaw>
}

/**
 * Parse the tab-separated output of the remote status script (see
 * `server/cyrus.ts`). One `SERVICE` line, then any number of `SESSION` and
 * `WORKTREE` lines — order doesn't matter, so this just buckets by tag.
 */
export function parseCyrusOverview(raw: string): ParsedCyrusOverview {
  const service: CyrusService = { cyrus: "unknown", ngrok: "unknown", api: "" }
  const sessions: Array<CyrusSession> = []
  const worktrees: Array<CyrusWorktreeRaw> = []

  for (const line of raw.split("\n")) {
    if (!line) continue
    const fields = line.split("\t")
    const tag = fields[0]
    if (tag === "SERVICE") {
      service.cyrus = fields[1] || "unknown"
      service.ngrok = fields[2] || "unknown"
      service.api = fields[3] || ""
    } else if (tag === "SESSION") {
      sessions.push({
        issue: fields[1],
        updatedAt: Number(fields[2]) * 1000,
        lastStep: fields[3] || "",
      })
    } else if (tag === "WORKTREE") {
      const repo = fields[6] || ""
      worktrees.push({
        name: fields[1],
        path: fields[2],
        branch: fields[3] || "",
        dirty: Number(fields[4]) || 0,
        sizeBytes: Number(fields[5]) || 0,
        repoPath: repo.endsWith("/.git") ? repo.slice(0, -5) : repo,
        origin: fields[7] || null,
        active: fields[8] === "1",
      })
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  worktrees.sort((a, b) => a.name.localeCompare(b.name))
  return { service, sessions, worktrees }
}

/** "github.com/owner/repo(.git)?" in any clone-URL form -> "owner/repo". */
export function parseGithubSlug(url: string | null): string | null {
  if (!url) return null
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url.trim())
  return match ? match[1] : null
}

/** "3m ago", "2h ago", "5d ago" — coarse, matches the CLI tool's style. */
export function formatAge(updatedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
