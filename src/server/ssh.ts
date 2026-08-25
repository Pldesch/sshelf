import { execFile, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// The remote directory the explorer is rooted at. Override with
// SSHELF_REMOTE_ROOT (should be an absolute path); defaults to /home/ubuntu.
export const REMOTE_ROOT = process.env.SSHELF_REMOTE_ROOT || "/home/ubuntu"

/** Thrown (by message) when no SSH host has been chosen yet. */
export const SETUP_REQUIRED = "SETUP_REQUIRED"

// The chosen host also lives in a tiny config file so SSR works right
// after a server restart, before the browser can send its stored choice.
const CONFIG_FILE = join(homedir(), ".sshelf.json")

function readPersistedHost(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as {
      sshHost?: string
    }
    return parsed.sshHost ?? null
  } catch {
    return null
  }
}

let sshHost: string | null = process.env.SSHELF_SSH_HOST || readPersistedHost()

export function getCurrentHost(): string | null {
  return sshHost
}

/** Switch hosts in memory — drops all caches and the circuit breaker. */
export function setSshHost(host: string | null) {
  sshHost = host
  globalCacheGeneration++
  cache.clear()
  inFlight.clear()
  knownMutationHosts.clear()
  downUntil = 0
}

export function persistSshHost(host: string) {
  setSshHost(host)
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify({ sshHost: host }))
  } catch {
    // memory-only is fine; the browser re-sends its stored choice
  }
}

export function requireHost(): string {
  if (!sshHost) throw new SshError(SETUP_REQUIRED)
  return sshHost
}

export interface SshConfigHost {
  alias: string
  hostName?: string
  user?: string
}

/** Scan ~/.ssh/config for concrete (non-wildcard) host aliases. */
export function listSshConfigHosts(): Array<SshConfigHost> {
  let text = ""
  try {
    text = readFileSync(join(homedir(), ".ssh", "config"), "utf-8")
  } catch {
    return []
  }
  const hosts: Array<SshConfigHost> = []
  let currentBlock: Array<SshConfigHost> = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const [keyword, ...rest] = line.split(/\s+/)
    const key = keyword.toLowerCase()
    if (key === "host") {
      currentBlock = rest
        .filter(
          (alias) =>
            !alias.includes("*") &&
            !alias.includes("?") &&
            !alias.startsWith("!")
        )
        .map((alias) => ({ alias }))
      hosts.push(...currentBlock)
    } else if (key === "hostname") {
      for (const host of currentBlock) host.hostName = rest.join(" ")
    } else if (key === "user") {
      for (const host of currentBlock) host.user = rest.join(" ")
    }
  }
  return hosts
}

// Reuse one SSH connection across requests where OpenSSH multiplexing is
// available. Windows OpenSSH does not reliably support these Unix socket args.
const SSH_BASE_ARGS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=5",
  "-o",
  "ServerAliveInterval=15",
  ...(process.platform === "win32"
    ? []
    : [
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPath=/tmp/sshelf-%C",
        "-o",
        "ControlPersist=3600",
      ]),
]

const MAX_OUTPUT_BYTES = 200 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 15_000

export class SshError extends Error {
  constructor(
    message: string,
    public connectionFailure = false
  ) {
    super(message)
  }
}

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Resolve a path relative to REMOTE_ROOT and make sure it cannot
 * escape it (no `..`, no absolute paths outside the root).
 */
export function resolveRemotePath(relativePath: string): string {
  const segments = relativePath
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.some((segment) => segment === "..")) {
    throw new SshError("Invalid path")
  }
  const joined = segments.join("/")
  return joined ? `${REMOTE_ROOT}/${joined}` : REMOTE_ROOT
}

function execRemote(command: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [...SSH_BASE_ARGS, requireHost(), command],
      {
        encoding: "buffer",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString("utf-8").trim()
          const timedOut = error.killed || error.signal === "SIGKILL"
          // ssh exits with 255 on connection/auth failure; anything else
          // is the remote command's own exit code (e.g. file not found).
          const connectionFailure =
            timedOut || (error as { code?: number | string }).code === 255
          reject(
            new SshError(
              timedOut
                ? "The server took too long to answer"
                : detail || error.message || "Could not reach the server",
              connectionFailure
            )
          )
        } else {
          resolve(stdout)
        }
      }
    )
  })
}

// Circuit breaker: after a hard failure, fail fast for a short window
// instead of letting every request wait out the connect timeout.
let downUntil = 0

/** Run a remote command, retrying once on failure (drops a dead tunnel). */
export async function runRemoteRaw(command: string): Promise<Buffer> {
  if (Date.now() < downUntil) {
    throw new SshError("The server is unreachable", true)
  }
  try {
    const result = await execRemote(command)
    downUntil = 0
    return result
  } catch (firstError) {
    if (firstError instanceof SshError && !firstError.connectionFailure) {
      throw firstError
    }
    try {
      const result = await execRemote(command)
      downUntil = 0
      return result
    } catch {
      downUntil = Date.now() + 10_000
      throw firstError
    }
  }
}

export async function runRemote(command: string): Promise<string> {
  return (await runRemoteRaw(command)).toString("utf-8")
}

/** Stream a remote file through the multiplexed SSH connection. Optional byte
 * bounds are inclusive and power HTTP Range responses for large PDFs/media. */
export function streamRemoteFile(
  relativePath: string,
  range?: { start: number; end: number },
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const absolute = resolveRemotePath(relativePath)
  const command = range
    ? `dd if=${shellQuote(absolute)} iflag=skip_bytes,count_bytes ` +
      `skip=${range.start} count=${range.end - range.start + 1} status=none`
    : `cat ${shellQuote(absolute)}`
  let child: ReturnType<typeof spawn> | null = null
  let closed = false

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal?.aborted) {
        controller.close()
        return
      }
      const process = spawn("ssh", [...SSH_BASE_ARGS, requireHost(), command], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      child = process
      const stderr: Array<Buffer> = []
      const abort = () => child?.kill("SIGKILL")
      signal?.addEventListener("abort", abort, { once: true })
      process.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
      process.stdout.on("data", (chunk: Buffer) => {
        if (!closed) controller.enqueue(new Uint8Array(chunk))
      })
      process.on("error", (error) => {
        if (closed) return
        closed = true
        signal?.removeEventListener("abort", abort)
        controller.error(new SshError(error.message, true))
      })
      process.on("close", (code) => {
        if (closed) return
        closed = true
        signal?.removeEventListener("abort", abort)
        if (signal?.aborted) {
          controller.close()
        } else if (code === 0) {
          controller.close()
        } else {
          const detail = Buffer.concat(stderr).toString("utf-8").trim()
          controller.error(
            new SshError(
              detail || "Could not read the remote file",
              code === 255
            )
          )
        }
      })
    },
    cancel() {
      closed = true
      child?.kill("SIGKILL")
    },
  })
}

/**
 * Run a remote command, streaming `input` to its stdin. Used to push file
 * contents to the server (`cat > file`) without embedding bytes in argv.
 */
function execRemoteStdin(command: string, input: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...SSH_BASE_ARGS, requireHost(), command], {
      stdio: ["pipe", "ignore", "pipe"],
    })
    const stderr: Array<Buffer> = []
    let settled = false
    const finish = (err?: SshError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      finish(new SshError("The server took too long to answer", true))
    }, COMMAND_TIMEOUT_MS)
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    // The remote may close stdin early (e.g. on error) — ignore the EPIPE.
    child.stdin.on("error", () => {})
    child.on("error", (error) =>
      finish(new SshError(error.message || "Could not reach the server", true))
    )
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = Buffer.concat(stderr).toString("utf-8").trim()
      const connectionFailure = signal === "SIGKILL" || code === 255
      finish(
        new SshError(detail || "Could not reach the server", connectionFailure)
      )
    })
    child.stdin.end(input)
  })
}

/** Create a directory (and any missing parents) on the remote. */
export async function makeRemoteDir(relativePath: string): Promise<void> {
  const absolute = resolveRemotePath(relativePath)
  await runRemote(`mkdir -p ${shellQuote(absolute)}`)
  invalidateRemotePath(relativePath)
  markRemoteMutation()
}

/** Write `content` to a remote file, creating missing parent directories. */
export async function writeRemoteFile(
  relativePath: string,
  content: Buffer
): Promise<void> {
  const absolute = resolveRemotePath(relativePath)
  const slash = absolute.lastIndexOf("/")
  const parent = slash > 0 ? absolute.slice(0, slash) : REMOTE_ROOT
  await execRemoteStdin(
    `mkdir -p ${shellQuote(parent)} && cat > ${shellQuote(absolute)}`,
    content
  )
  invalidateRemotePath(relativePath)
  markRemoteMutation()
}

/* ── In-memory cache: fresh within TTL, stale data survives as a
     fallback so the app keeps working when the connection drops. ── */

interface CacheSlot {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, CacheSlot>()
const inFlight = new Map<string, Promise<unknown>>()
const cacheGenerations = new Map<string, number>()
let globalCacheGeneration = 0
const knownMutationHosts = new Set<string>()

export interface CachedResult<T> {
  value: T
  /** True when SSH failed and this is older data kept as a fallback. */
  stale: boolean
}

export async function withCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<CachedResult<T>> {
  const slot = cache.get(key)
  if (slot && slot.expiresAt > Date.now()) {
    return { value: slot.value as T, stale: false }
  }
  const pending = inFlight.get(key)
  if (pending) {
    return (await pending) as CachedResult<T>
  }
  const keyGeneration = cacheGenerations.get(key) ?? 0
  const startedAtGlobalGeneration = globalCacheGeneration
  const promise = (async () => {
    try {
      const value = await fetcher()
      if (
        globalCacheGeneration === startedAtGlobalGeneration &&
        (cacheGenerations.get(key) ?? 0) === keyGeneration
      ) {
        cache.set(key, { value, expiresAt: Date.now() + ttlMs })
      }
      return { value, stale: false }
    } catch (error) {
      if (slot) return { value: slot.value as T, stale: true }
      throw error
    } finally {
      if (
        globalCacheGeneration === startedAtGlobalGeneration &&
        (cacheGenerations.get(key) ?? 0) === keyGeneration
      ) {
        inFlight.delete(key)
      }
    }
  })()
  inFlight.set(key, promise)
  return await promise
}

export function invalidateRemoteCacheKey(key: string) {
  cache.delete(key)
  inFlight.delete(key)
  cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
}

/**
 * Invalidate only the resources affected by a path mutation. A generation is
 * bumped for every key so an older in-flight read can never repopulate stale
 * data after the mutation completes.
 */
export function invalidateRemotePath(relativePath: string, oldPath?: string) {
  const paths = [relativePath, oldPath].filter(
    (value): value is string => typeof value === "string"
  )
  invalidateRemoteCacheKey("tree:all")
  for (const path of paths) {
    invalidateRemoteCacheKey(`entry:${path}`)
    invalidateRemoteCacheKey(`file:${path}`)
    const slash = path.lastIndexOf("/")
    const parent = slash === -1 ? "" : path.slice(0, slash)
    invalidateRemoteCacheKey(`dir:${parent}`)
    // Folder moves/deletes can leave cached descendants under the old prefix.
    for (const key of [...cache.keys(), ...inFlight.keys()]) {
      if (
        key.startsWith(`dir:${path}/`) ||
        key.startsWith(`entry:${path}/`) ||
        key.startsWith(`file:${path}/`)
      ) {
        invalidateRemoteCacheKey(key)
      }
    }
  }
}

/** Mark a write performed by this process so the polling fallback does not
 * echo it back to the client as an out-of-band change a few seconds later. */
export function markRemoteMutation() {
  if (sshHost) knownMutationHosts.add(sshHost)
}

export function consumeKnownRemoteMutation(host: string): boolean {
  const known = knownMutationHosts.has(host)
  knownMutationHosts.delete(host)
  return known
}

/** Drop all cached listings/contents after an unknown out-of-band change. */
export function clearRemoteCache() {
  globalCacheGeneration++
  cache.clear()
  inFlight.clear()
}

export interface RemoteEntry {
  name: string
  /** Path relative to REMOTE_ROOT, e.g. "Process/CONTEXT.md" */
  path: string
  type: "dir" | "file"
  size: number
  modifiedAt: number
}

const TREE_TTL_MS = 30_000
const FILE_TTL_MS = 60_000
const VISIBLE_DOT_DIRECTORY_NAMES = [".claude"]
const PRUNED_DIRECTORY_NAMES = [
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]
const VISIBLE_DOT_DIRECTORY_TEST = VISIBLE_DOT_DIRECTORY_NAMES.map(
  (name) => `-name ${shellQuote(name)}`
).join(" -o ")
const FIND_PRUNE_EXPRESSION = PRUNED_DIRECTORY_NAMES.map(
  (name) => `-name ${shellQuote(name)}`
).join(" -o ")

function parseFindEntries(output: string): Array<RemoteEntry> {
  const entries: Array<RemoteEntry> = []
  for (const line of output.split("\n")) {
    if (!line) continue
    const [type, size, mtime, ...pathParts] = line.split("\t")
    const path = pathParts.join("\t")
    if (!path || (type !== "d" && type !== "f")) continue
    const slash = path.lastIndexOf("/")
    entries.push({
      name: slash === -1 ? path : path.slice(slash + 1),
      path,
      type: type === "d" ? "dir" : "file",
      size: Number(size),
      modifiedAt: Math.floor(Number(mtime) * 1000),
    })
  }
  return entries
}

/** Fetch the complete visible tree only for global search and the move-folder
 * picker. Normal browsing and the sidebar use lazy direct-directory reads. */
export async function fetchTree(): Promise<CachedResult<Array<RemoteEntry>>> {
  return withCache("tree:all", TREE_TTL_MS, async () => {
    const output = await runRemote(
      `find ${shellQuote(REMOTE_ROOT)} -mindepth 1 ` +
        `\\( -name '.*' ! \\( ${VISIBLE_DOT_DIRECTORY_TEST} \\) -o ${FIND_PRUNE_EXPRESSION} \\) -prune ` +
        `-o -printf '%y\\t%s\\t%T@\\t%P\\n'`
    )
    return parseFindEntries(output)
  })
}

const entryCollator = new Intl.Collator(undefined, { sensitivity: "base" })

export function sortEntries(entries: Array<RemoteEntry>): Array<RemoteEntry> {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return entryCollator.compare(a.name, b.name)
  })
}

export async function listRemoteDir(
  relativePath: string
): Promise<CachedResult<Array<RemoteEntry>>> {
  const absolute = resolveRemotePath(relativePath)
  return withCache(`dir:${relativePath}`, TREE_TTL_MS, async () => {
    const output = await runRemote(
      `find ${shellQuote(absolute)} -mindepth 1 -maxdepth 1 ` +
        `\\( -name '.*' ! \\( ${VISIBLE_DOT_DIRECTORY_TEST} \\) -o ${FIND_PRUNE_EXPRESSION} \\) -prune ` +
        `-o ! -type l \\( -type d -o -type f \\) -printf '%y\\t%s\\t%T@\\t%P\\n'`
    )
    const prefix = relativePath ? `${relativePath}/` : ""
    const entries = parseFindEntries(output).map((entry) => ({
      ...entry,
      path: `${prefix}${entry.path}`,
    }))
    return sortEntries(entries)
  })
}

export async function findEntry(
  relativePath: string
): Promise<CachedResult<RemoteEntry | null>> {
  const absolute = resolveRemotePath(relativePath)
  return withCache(`entry:${relativePath}`, TREE_TTL_MS, async () => {
    const output = await runRemote(
      `if [ ! -e ${shellQuote(absolute)} ] || [ -L ${shellQuote(absolute)} ]; ` +
        `then exit 0; fi; find ${shellQuote(absolute)} -maxdepth 0 ` +
        `\\( -type d -o -type f \\) -printf '%y\\t%s\\t%T@\\t%f\\n'`
    )
    const parsed = parseFindEntries(output).at(0)
    return parsed ? { ...parsed, name: parsed.path, path: relativePath } : null
  })
}

export async function readRemoteFile(
  relativePath: string
): Promise<CachedResult<Buffer>> {
  const absolute = resolveRemotePath(relativePath)
  return withCache(`file:${relativePath}`, FILE_TTL_MS, () =>
    runRemoteRaw(`cat ${shellQuote(absolute)}`)
  )
}

export interface SearchResult {
  path: string
  type: "dir" | "file"
  matchedBy: "name" | "content"
  /** For content matches: the matching line, trimmed to context around the hit. */
  snippet?: string
}

export async function searchRemote(
  query: string
): Promise<Array<SearchResult>> {
  requireHost()
  const cleaned = query.trim()
  if (!cleaned) return []

  // Name matches come from the cached tree — instant and offline-safe.
  const results = new Map<string, SearchResult>()
  let tree: CachedResult<Array<RemoteEntry>> | null = null
  try {
    tree = await fetchTree()
    const needle = cleaned.toLowerCase()
    for (const entry of tree.value) {
      if (entry.name.toLowerCase().includes(needle)) {
        results.set(entry.path, {
          path: entry.path,
          type: entry.type,
          matchedBy: "name",
        })
      }
    }
  } catch {
    // fall through — content search below may still work
  }

  // Content matches need one remote grep; skip silently if unreachable.
  // `-m1` keeps the first hit per file, `-HZ` prints "PATH\0matching line"
  // (NUL keeps paths with colons unambiguous) so we can show a snippet.
  try {
    const output = await runRemoteRaw(
      `find ${shellQuote(REMOTE_ROOT)} -type d \\( -name '.*' ! \\( ${VISIBLE_DOT_DIRECTORY_TEST} \\) -o ${FIND_PRUNE_EXPRESSION} \\) -prune -o -type f ! -type l \\( -name '*.md' -o -name '*.txt' -o -name '*.json' -o -name '*.jsonl' -o -name '*.html' \\) -print0 | xargs -0 grep -m1 -HIiZ -e ${shellQuote(cleaned)} 2>/dev/null | head -40`
    )
    for (const record of output.toString("utf-8").split("\n")) {
      const nul = record.indexOf("\0")
      if (nul === -1) continue
      const absolute = record.slice(0, nul)
      if (!absolute.startsWith(`${REMOTE_ROOT}/`)) continue
      const path = absolute.slice(REMOTE_ROOT.length + 1)
      if (!results.has(path)) {
        results.set(path, {
          path,
          type: "file",
          matchedBy: "content",
          snippet: buildSnippet(record.slice(nul + 1), cleaned),
        })
      }
    }
  } catch {
    if (!tree) throw new SshError("Could not reach the server")
  }

  const needle = cleaned.toLowerCase()
  return [...results.values()].sort((a, b) => {
    const sa = rankSearchResult(a, needle)
    const sb = rankSearchResult(b, needle)
    if (sa !== sb) return sa - sb
    // Shorter paths usually mean shallower, more relevant "pages".
    if (a.path.length !== b.path.length) return a.path.length - b.path.length
    return a.path.localeCompare(b.path)
  })
}

/**
 * Lower is better. Name matches outrank content matches, and within name
 * matches an exact filename beats a prefix beats a loose substring — so the
 * page you typed the name of lands at the top of the quick-open list.
 */
function rankSearchResult(result: SearchResult, needle: string): number {
  if (result.matchedBy === "content") return 4
  const slash = result.path.lastIndexOf("/")
  const name = (
    slash === -1 ? result.path : result.path.slice(slash + 1)
  ).toLowerCase()
  if (name === needle) return 0
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  return 3
}

/**
 * Trim a matching line down to a few words on either side of the hit so the
 * palette can show where the match lives without dumping a whole (possibly
 * minified) line. Snaps to word boundaries and marks elision with "…".
 */
const SNIPPET_RADIUS = 36

function buildSnippet(line: string, query: string): string {
  const text = line.replace(/\s+/g, " ").trim()
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2)

  const hitEnd = idx + query.length
  let start = Math.max(0, idx - SNIPPET_RADIUS)
  let end = Math.min(text.length, hitEnd + SNIPPET_RADIUS)
  // Snap outward edges to whole words so we never cut mid-word.
  if (start > 0) {
    const space = text.indexOf(" ", start)
    if (space !== -1 && space < idx) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end)
    if (space > hitEnd) end = space
  }

  let snippet = text.slice(start, end).trim()
  if (start > 0) snippet = `… ${snippet}`
  if (end < text.length) snippet = `${snippet} …`
  return snippet
}
