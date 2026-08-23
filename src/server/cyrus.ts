import { createServerFn } from "@tanstack/react-start"
import { parseCyrusOverview, parseGithubSlug } from "@/lib/cyrus"
import {
  clearRemoteCache,
  getCurrentHost,
  runRemote,
  shellQuote,
  withCache,
} from "@/server/ssh"
import type { CyrusService, CyrusSession } from "@/lib/cyrus"

export interface PullRequestInfo {
  number: number
  state: "OPEN" | "MERGED" | "CLOSED"
  title: string
  url: string
  isDraft: boolean
}

export interface CyrusWorktree {
  name: string
  path: string
  branch: string
  dirty: number
  sizeBytes: number
  repoPath: string
  repoSlug: string | null
  active: boolean
  pr: PullRequestInfo | null
  linearUrl: string | null
}

export interface CyrusOverview {
  host: string | null
  service: CyrusService
  sessions: Array<CyrusSession>
  worktrees: Array<CyrusWorktree>
  stale: boolean
}

const OVERVIEW_TTL_MS = 10_000

// One remote script gathers everything in a single SSH round trip: service
// status, per-issue session activity (from the readable transcripts
// cyrus-status already writes), and one `git`/`du` probe per worktree. Fields
// are tab-separated so a stray newline in a session's last step can't shift
// columns; free-text fields are stripped of tabs/newlines before printing.
const STATUS_SCRIPT = `
set -uo pipefail
CY="$HOME/.cyrus"

printf 'SERVICE\\t%s\\t%s\\t%s\\n' \\
  "$(systemctl is-active cyrus 2>/dev/null || echo unknown)" \\
  "$(systemctl is-active ngrok-cyrus 2>/dev/null || echo unknown)" \\
  "$(curl -s -m 5 http://localhost:3456/status 2>/dev/null | tr -d '\\t\\n')"

for d in "$CY"/logs/*/; do
  [ -d "$d" ] || continue
  issue=$(basename "$d")
  f=$(ls -t "$d"session-*.md 2>/dev/null | grep -v pending | head -1)
  [ -z "$f" ] && continue
  last=$(grep -aE '^#{2,3} [0-9]{2}:[0-9]{2}:[0-9]{2}' "$f" | tail -1 | sed 's/^#* //' | tr -d '\\t\\n')
  mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  printf 'SESSION\\t%s\\t%s\\t%s\\n' "$issue" "$mtime" "$last"
done

ACTIVE_CWDS=""
for pid in $(pgrep -f 'claude-agent-sdk' 2>/dev/null); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  [ -n "$cwd" ] && ACTIVE_CWDS="$ACTIVE_CWDS$cwd
"
done
is_active() { printf '%s' "$ACTIVE_CWDS" | grep -qxF "$1"; }

for w in "$CY"/worktrees/*/; do
  [ -d "$w" ] || continue
  w="\${w%/}"
  name=$(basename "$w")
  branch=$(git -C "$w" rev-parse --abbrev-ref HEAD 2>/dev/null)
  dirty=$(git -C "$w" status --porcelain 2>/dev/null | wc -l)
  size=$(du -sb "$w" 2>/dev/null | cut -f1)
  repo=$(git -C "$w" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  origin=$(git -C "$w" remote get-url origin 2>/dev/null | tr -d '\\t\\n')
  active=0
  is_active "$w" && active=1
  printf 'WORKTREE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \\
    "$name" "$w" "$branch" "$dirty" "\${size:-0}" "$repo" "$origin" "$active"
done
`

async function fetchPullRequests(
  slugs: ReadonlySet<string>
): Promise<Map<string, PullRequestInfo>> {
  const byKey = new Map<string, PullRequestInfo>()
  for (const slug of slugs) {
    try {
      const out = await runRemote(
        `gh pr list --repo ${shellQuote(slug)} --state all --json number,state,title,url,isDraft,headRefName`
      )
      const prs = JSON.parse(out) as Array<{
        number: number
        state: "OPEN" | "MERGED" | "CLOSED"
        title: string
        url: string
        isDraft: boolean
        headRefName: string
      }>
      for (const pr of prs) {
        byKey.set(`${slug}::${pr.headRefName}`, {
          number: pr.number,
          state: pr.state,
          title: pr.title,
          url: pr.url,
          isDraft: pr.isDraft,
        })
      }
    } catch {
      // No `gh`, no auth, or a private/non-GitHub remote — PR info is
      // best-effort, so the rest of the dashboard still renders.
    }
  }
  return byKey
}

interface CyrusConfig {
  repositories?: Array<{
    repositoryPath: string
    linearWorkspaceId: string
    teamKeys?: Array<string>
  }>
  linearWorkspaces?: Record<string, { linearToken: string }>
}

interface RepoLinearInfo {
  token: string
  teamKeys: Array<string>
}

/** repoPath -> Linear API token + team keys, from the config Cyrus itself uses. */
async function readLinearInfoByRepo(): Promise<Map<string, RepoLinearInfo>> {
  const cached = await withCache("cyrusConfig", 5 * 60_000, () =>
    runRemote('cat "$HOME/.cyrus/config.json" 2>/dev/null || echo "{}"')
  )
  const byRepo = new Map<string, RepoLinearInfo>()
  try {
    const config = JSON.parse(cached.value) as CyrusConfig
    for (const repo of config.repositories ?? []) {
      const token =
        config.linearWorkspaces?.[repo.linearWorkspaceId]?.linearToken
      if (token) {
        byRepo.set(repo.repositoryPath, {
          token,
          teamKeys: repo.teamKeys ?? [],
        })
      }
    }
  } catch {
    // Missing or malformed config — Linear links just won't resolve.
  }
  return byRepo
}

interface LinearIssueLookup {
  identifier: string
  url: string
}

// Linear issue URLs never change once assigned, so a name resolved once
// (e.g. "PEB-14") is cached for the life of the process — no need to ask
// Linear again on every 15s poll. Runs through the SSH host (not fetched
// directly from this app) so the API token never has to leave the server.
const linearUrlCache = new Map<string, string>()

async function resolveLinearUrls(
  infoByRepo: ReadonlyMap<string, RepoLinearInfo>,
  worktrees: ReadonlyArray<{ name: string; repoPath: string }>
): Promise<void> {
  const namesByToken = new Map<string, Set<string>>()
  for (const w of worktrees) {
    if (linearUrlCache.has(w.name)) continue
    const info = infoByRepo.get(w.repoPath)
    if (!info) continue
    // Cyrus also creates PR-review worktrees (e.g. "PR-7") that aren't
    // Linear issues at all. Querying Linear for one of those doesn't just
    // fail for that alias — Linear nulls the ENTIRE response when any
    // aliased issue id in the batch doesn't exist, so an unfiltered batch
    // would silently kill every real issue's link too.
    if (!info.teamKeys.some((key) => w.name.startsWith(`${key}-`))) continue
    const names = namesByToken.get(info.token) ?? new Set<string>()
    names.add(w.name)
    namesByToken.set(info.token, names)
  }

  for (const [token, names] of namesByToken) {
    const fields = [...names]
      .map(
        (name, i) =>
          `i${i}: issue(id: ${JSON.stringify(name)}) { identifier url }`
      )
      .join(" ")
    try {
      const out = await runRemote(
        `curl -s -m 10 https://api.linear.app/graphql ` +
          `-H ${shellQuote("Content-Type: application/json")} ` +
          `-H ${shellQuote(`Authorization: ${token}`)} ` +
          `-d ${shellQuote(JSON.stringify({ query: `query { ${fields} }` }))}`
      )
      const parsed = JSON.parse(out) as {
        data?: Record<string, LinearIssueLookup | null>
      }
      for (const issue of Object.values(parsed.data ?? {})) {
        if (issue) linearUrlCache.set(issue.identifier, issue.url)
      }
    } catch {
      // No network from the remote, a bad/expired token, or a malformed
      // response — Linear links are best-effort, same as PR lookups.
    }
  }
}

export const getCyrusOverview = createServerFn().handler(
  async (): Promise<CyrusOverview> => {
    const cached = await withCache("cyrusOverview", OVERVIEW_TTL_MS, () =>
      runRemote(STATUS_SCRIPT)
    )
    const parsed = parseCyrusOverview(cached.value)

    const slugs = new Set<string>()
    for (const w of parsed.worktrees) {
      const slug = parseGithubSlug(w.origin)
      if (slug) slugs.add(slug)
    }
    const [prs, linearInfoByRepo] = await Promise.all([
      fetchPullRequests(slugs),
      readLinearInfoByRepo(),
    ])
    await resolveLinearUrls(linearInfoByRepo, parsed.worktrees)

    const worktrees: Array<CyrusWorktree> = parsed.worktrees.map((w) => {
      const slug = parseGithubSlug(w.origin)
      return {
        name: w.name,
        path: w.path,
        branch: w.branch,
        dirty: w.dirty,
        sizeBytes: w.sizeBytes,
        repoPath: w.repoPath,
        repoSlug: slug,
        active: w.active,
        pr: (slug && prs.get(`${slug}::${w.branch}`)) || null,
        linearUrl: linearUrlCache.get(w.name) ?? null,
      }
    })

    return {
      host: getCurrentHost(),
      service: parsed.service,
      sessions: parsed.sessions,
      worktrees,
      stale: cached.stale,
    }
  }
)

// Archive only ever targets a path this app itself reported (via
// getCyrusOverview), so pin it to exactly that shape: an absolute path whose
// last segment is a worktree name under .cyrus/worktrees. This also rules
// out "." and ".." as the name, since both start with a dot.
const WORKTREE_PATH_RE = /\/\.cyrus\/worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/

function validateWorktreePath(path: string): string {
  if (!WORKTREE_PATH_RE.test(path)) {
    throw new Error("Invalid worktree path")
  }
  return path
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export const archiveWorktree = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; force?: boolean }) => data)
  .handler(async ({ data }) => {
    const path = validateWorktreePath(data.path)
    const name = basename(path)
    const q = shellQuote(path)

    // One round trip: existence, active-session, and dirty checks, plus the
    // repo path needed for `git worktree remove`. Every branch prints a
    // single tagged line so the caller never has to guess which failed.
    const precheck = (
      await runRemote(`
set -uo pipefail
if [ ! -d ${q} ]; then echo "MISSING"; exit 0; fi
ACTIVE_CWDS=""
for pid in $(pgrep -f 'claude-agent-sdk' 2>/dev/null); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  [ -n "$cwd" ] && ACTIVE_CWDS="$ACTIVE_CWDS$cwd
"
done
if printf '%s' "$ACTIVE_CWDS" | grep -qxF ${q}; then echo "ACTIVE"; exit 0; fi
dirty=$(git -C ${q} status --porcelain 2>/dev/null | wc -l)
repo=$(git -C ${q} rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
printf 'OK\\t%s\\t%s\\n' "$dirty" "$repo"
`)
    ).trim()

    if (precheck === "MISSING") {
      throw new Error(`"${name}" no longer exists`)
    }
    if (precheck === "ACTIVE") {
      throw new Error("An agent session is currently active in this worktree")
    }
    const [, dirtyText, repoRaw] = precheck.split("\t")
    const dirty = Number(dirtyText) || 0
    if (dirty > 0 && !data.force) {
      throw new Error(
        `${dirty} uncommitted file(s) — archive again with force to discard them`
      )
    }
    if (!repoRaw) {
      throw new Error(`"${name}" is not a git worktree`)
    }
    const repoPath = repoRaw.endsWith("/.git") ? repoRaw.slice(0, -5) : repoRaw

    await runRemote(
      `git -C ${shellQuote(repoPath)} worktree remove --force ${q} && ` +
        `git -C ${shellQuote(repoPath)} worktree prune`
    )
    clearRemoteCache()
    return { ok: true }
  })
