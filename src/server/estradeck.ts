import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, posix, resolve, sep } from "node:path"
import { EDIT_CONFLICT_MARKER } from "@/lib/edit-conflict"
import { fileKindOf, nameOf, parentOf } from "@/lib/file-kinds"
import { MANAGED_TRASH_DIRECTORY } from "@/lib/trash"
import { contentRevision } from "@/server/content-revision"
import {
  REMOTE_ROOT,
  SshError,
  findEntry,
  getCurrentHost,
  invalidateRemotePath,
  markRemoteMutation,
  readRemoteFile,
  resolveRemotePath,
  runRemote,
  shellQuote,
  writeRemoteFile,
  writeRemoteFileIfRevision,
} from "@/server/ssh"

const MAX_DECK_BYTES = 4 * 1024 * 1024
const MAX_ASSET_BYTES = 25 * 1024 * 1024
const SESSION_FILE = ".sshelf-session.json"
const DECK_FILE = "presentation.html"
const STYLES_FILE = "styles.css"
const DEFAULT_EDITOR_URL = "/estradeck/"

export const ESTRADECK_PRESENTATIONS_DIR = resolve(
  process.env.ESTRADECK_PRESENTATIONS_DIR ??
    join(tmpdir(), "sshelf-estradeck-presentations")
)

interface SessionMetadata {
  version: 1
  deckId: string
  path: string
  stylesPath: string
  workspace: string
  expectedRevision: string
  lastSyncedRevision: string
}

export interface EstradeckSession {
  available: boolean
  deckId?: string
  editorUrl?: string
  reason?: string
}

export interface EstradeckSyncResult {
  content: string | null
  revision: string | null
  size: number
  modifiedAt: number
}

const syncQueues = new Map<string, Promise<EstradeckSyncResult>>()

export function normalizeEstradeckEditorUrl(candidate: string): string | null {
  if (candidate.startsWith("/")) {
    if (candidate.startsWith("//")) return null
    const url = new URL(candidate, "http://sshelf.invalid")
    url.pathname =
      url.pathname === "/" ? "/" : `${url.pathname.replace(/\/+$/, "")}/`
    return url.pathname
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.pathname =
      url.pathname === "/" ? "/" : `${url.pathname.replace(/\/+$/, "")}/`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function configuredEditorUrl(): string | null {
  const configured = process.env.SSHELF_ESTRADECK_URL
  if (!configured && process.env.NODE_ENV !== "development") return null
  return normalizeEstradeckEditorUrl(configured ?? DEFAULT_EDITOR_URL)
}

function deckIdFor(path: string): string {
  const identity = `${getCurrentHost() ?? ""}\0${REMOTE_ROOT}\0${path}`
  return `sshelf-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`
}

function assertDeckId(deckId: string): string {
  if (!/^sshelf-[a-f0-9]{24}$/.test(deckId)) {
    throw new SshError("Invalid Estradeck session")
  }
  return deckId
}

function sessionDirectory(deckId: string): string {
  const directory = resolve(ESTRADECK_PRESENTATIONS_DIR, assertDeckId(deckId))
  if (!directory.startsWith(`${ESTRADECK_PRESENTATIONS_DIR}${sep}`)) {
    throw new SshError("Invalid Estradeck session")
  }
  return directory
}

async function atomicWrite(file: string, content: string | Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await mkdir(dirname(file), { recursive: true })
  try {
    await writeFile(temporary, content, { flag: "wx" })
    await rename(temporary, file)
  } finally {
    try {
      await unlink(temporary)
    } catch {
      // The rename normally consumes the temporary file.
    }
  }
}

function hasStylesheetReference(
  source: string,
  stylesheetName: string
): boolean {
  const escaped = stylesheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `\\bhref\\s*=\\s*["'](?:\\./)?${escaped}(?:[?#][^"']*)?["']`,
    "i"
  ).test(source)
}

function withEstradeckStylesheet(
  source: string,
  stylesheetName: string
): string {
  if (hasStylesheetReference(source, stylesheetName)) {
    return source
  }
  const link = `<link rel="stylesheet" href="${stylesheetName}">`
  if (/<\/head\s*>/i.test(source)) {
    return source.replace(/<\/head\s*>/i, `  ${link}\n</head>`)
  }
  return `${link}\n${source}`
}

function stylesPathFor(deckPath: string, source: string): string {
  const remoteParent = parentOf(deckPath)
  if (hasStylesheetReference(source, STYLES_FILE)) {
    return remoteParent ? `${remoteParent}/${STYLES_FILE}` : STYLES_FILE
  }
  const name = posix.basename(deckPath).replace(/\.html$/i, ".css")
  return remoteParent ? `${remoteParent}/${name}` : name
}

export function normalizeEstradeckAssetReference(raw: string): string | null {
  const withoutQuery = raw.split(/[?#]/, 1)[0].trim()
  if (
    !withoutQuery ||
    withoutQuery.startsWith("/") ||
    withoutQuery.startsWith("//") ||
    withoutQuery.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(withoutQuery)
  ) {
    return null
  }
  const normalized = posix.normalize(withoutQuery)
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null
  }
  return normalized
}

function referencedAssets(source: string): Array<string> {
  const references = new Set<string>()
  const patterns = [
    /\b(?:src|href|poster|data-background-image|data-background-video)\s*=\s*["']([^"']+)["']/gi,
    /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const reference = normalizeEstradeckAssetReference(match[1])
      if (reference) references.add(reference)
    }
  }
  return [...references]
}

async function mirrorReferencedAssets(
  deckPath: string,
  source: string,
  deckId: string
) {
  const directory = sessionDirectory(deckId)
  const remoteParent = parentOf(deckPath)
  await Promise.all(
    referencedAssets(source).map(async (reference) => {
      const remotePath = remoteParent
        ? `${remoteParent}/${reference}`
        : reference
      try {
        const found = await findEntry(remotePath)
        if (
          !found.value ||
          found.value.type !== "file" ||
          found.value.size > MAX_ASSET_BYTES
        ) {
          return
        }
        const file = await readRemoteFile(remotePath)
        const destination = resolve(directory, ...reference.split("/"))
        if (!destination.startsWith(`${directory}${sep}`)) return
        await atomicWrite(destination, file.value)
      } catch {
        // Missing optional assets must not prevent the deck from opening.
      }
    })
  )
}

async function readMetadata(deckId: string): Promise<SessionMetadata> {
  const raw = await readFile(
    join(sessionDirectory(deckId), SESSION_FILE),
    "utf-8"
  )
  const metadata = JSON.parse(raw) as Partial<SessionMetadata>
  const path = typeof metadata.path === "string" ? metadata.path : ""
  const parent = parentOf(path)
  const allowedStyles = [
    parent ? `${parent}/${STYLES_FILE}` : STYLES_FILE,
    stylesPathFor(path, ""),
  ]
  if (
    metadata.version !== 1 ||
    metadata.deckId !== deckId ||
    !path ||
    fileKindOf(path) !== "slides" ||
    deckIdFor(path) !== deckId ||
    typeof metadata.stylesPath !== "string" ||
    !allowedStyles.includes(metadata.stylesPath) ||
    typeof metadata.workspace !== "string" ||
    metadata.workspace !== `${getCurrentHost() ?? ""}\0${REMOTE_ROOT}` ||
    typeof metadata.expectedRevision !== "string" ||
    typeof metadata.lastSyncedRevision !== "string"
  ) {
    throw new SshError("Estradeck session is no longer valid")
  }
  return metadata as SessionMetadata
}

async function writeMetadata(metadata: SessionMetadata) {
  await atomicWrite(
    join(sessionDirectory(metadata.deckId), SESSION_FILE),
    JSON.stringify(metadata)
  )
}

async function trashEstradeckAsset(path: string) {
  const found = await findEntry(path)
  if (!found.value) return
  if (found.value.type !== "file") {
    throw new SshError("Estradeck can only remove asset files")
  }
  const absolute = resolveRemotePath(path)
  const trashDirectory = resolveRemotePath(MANAGED_TRASH_DIRECTORY)
  const trashPath = `${MANAGED_TRASH_DIRECTORY}/${Date.now()}-${randomUUID()}-${nameOf(path)}`
  const trashAbsolute = resolveRemotePath(trashPath)
  await runRemote(
    `mkdir -p ${shellQuote(trashDirectory)} && ` +
      `mv -- ${shellQuote(absolute)} ${shellQuote(trashAbsolute)}`
  )
  invalidateRemotePath(path)
  markRemoteMutation()
}

export async function prepareEstradeckSessionImpl(
  path: string
): Promise<EstradeckSession> {
  const editorUrl = configuredEditorUrl()
  if (!editorUrl) {
    return {
      available: false,
      reason: "Estradeck is not configured for this runtime",
    }
  }
  if (!path || fileKindOf(path) !== "slides") {
    throw new SshError("Only .slides.html files can open in Estradeck")
  }

  invalidateRemotePath(path)
  const found = await findEntry(path)
  if (!found.value || found.value.type !== "file") {
    throw new SshError(`"${path}" was not found`)
  }
  if (found.value.size > MAX_DECK_BYTES) {
    throw new SshError("This presentation is too large to edit")
  }
  const file = await readRemoteFile(path)
  const source = file.value.toString("utf-8")
  const revision = contentRevision(source)
  const deckId = deckIdFor(path)
  const directory = sessionDirectory(deckId)
  const stylesPath = stylesPathFor(path, source)
  const stylesheetName = posix.basename(stylesPath)
  await mkdir(directory, { recursive: true })

  const metadata: SessionMetadata = {
    version: 1,
    deckId,
    path,
    stylesPath,
    workspace: `${getCurrentHost() ?? ""}\0${REMOTE_ROOT}`,
    expectedRevision: revision,
    lastSyncedRevision: revision,
  }
  await writeMetadata(metadata)
  await atomicWrite(
    join(directory, DECK_FILE),
    withEstradeckStylesheet(source, stylesheetName)
  )
  try {
    const styles = await readRemoteFile(stylesPath)
    await atomicWrite(join(directory, STYLES_FILE), styles.value)
  } catch {
    await atomicWrite(join(directory, STYLES_FILE), "")
  }
  await mirrorReferencedAssets(path, source, deckId)

  const relativeEditor = editorUrl.startsWith("/")
  const url = new URL(editorUrl, "http://sshelf.invalid")
  url.searchParams.set("embed", "sshelf")
  url.searchParams.set("deck", deckId)
  return {
    available: true,
    deckId,
    editorUrl: relativeEditor ? `${url.pathname}${url.search}` : url.toString(),
  }
}

export function normalizeEstradeckChangedFile(file: string): string | null {
  if (file === DECK_FILE || file === STYLES_FILE) return file
  const normalized = posix.normalize(file)
  if (
    (normalized.startsWith("images/") || normalized.startsWith("videos/")) &&
    !normalized.includes("/../") &&
    !normalized.endsWith("/..")
  ) {
    return normalized
  }
  return null
}

async function syncSessionFile(
  deckId: string,
  changedFile: string,
  deleted: boolean
): Promise<EstradeckSyncResult> {
  const metadata = await readMetadata(deckId)
  const file = normalizeEstradeckChangedFile(changedFile)
  if (!file) throw new SshError("Estradeck reported an invalid file change")
  if (deleted) {
    if (file === DECK_FILE || file === STYLES_FILE) {
      throw new SshError("Estradeck cannot remove deck source files")
    }
    const remoteParent = parentOf(metadata.path)
    const remotePath = remoteParent ? `${remoteParent}/${file}` : file
    await trashEstradeckAsset(remotePath)
    return { content: null, revision: null, size: 0, modifiedAt: Date.now() }
  }
  const localFile = resolve(sessionDirectory(deckId), ...file.split("/"))
  if (!localFile.startsWith(`${sessionDirectory(deckId)}${sep}`)) {
    throw new SshError("Estradeck reported an invalid file change")
  }

  const localStat = await stat(localFile)
  const limit = file === DECK_FILE ? MAX_DECK_BYTES : MAX_ASSET_BYTES
  if (!localStat.isFile() || localStat.size > limit) {
    throw new SshError("Estradeck produced an unsupported file")
  }
  const content = await readFile(localFile)

  if (file === DECK_FILE) {
    const revision = contentRevision(content)
    if (revision === metadata.lastSyncedRevision) {
      return {
        content: content.toString("utf-8"),
        revision,
        size: content.byteLength,
        modifiedAt: localStat.mtimeMs,
      }
    }
    try {
      await writeRemoteFileIfRevision(
        metadata.path,
        content,
        metadata.expectedRevision
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(EDIT_CONFLICT_MARKER)
      ) {
        throw new SshError(
          `${EDIT_CONFLICT_MARKER}: the workspace deck changed outside Estradeck`
        )
      }
      throw error
    }
    metadata.expectedRevision = revision
    metadata.lastSyncedRevision = revision
    await writeMetadata(metadata)
    return {
      content: content.toString("utf-8"),
      revision,
      size: content.byteLength,
      modifiedAt: Date.now(),
    }
  }

  let deckResult: EstradeckSyncResult | null = null
  if (file === STYLES_FILE) {
    // Existing Sshelf decks often keep all CSS inline. Estradeck edits a
    // sidecar stylesheet, so persist the injected link on the first style
    // change rather than mutating the deck merely by opening it.
    deckResult = await syncSessionFile(deckId, DECK_FILE, false)
  }
  const remoteParent = parentOf(metadata.path)
  const remotePath =
    file === STYLES_FILE
      ? metadata.stylesPath
      : remoteParent
        ? `${remoteParent}/${file}`
        : file
  await writeRemoteFile(remotePath, content)
  return (
    deckResult ?? {
      content: null,
      revision: null,
      size: content.byteLength,
      modifiedAt: Date.now(),
    }
  )
}

export async function syncEstradeckSessionImpl(
  deckId: string,
  file: string,
  deleted = false
): Promise<EstradeckSyncResult> {
  const previous = syncQueues.get(deckId) ?? Promise.resolve(null)
  const next = previous
    .catch(() => null)
    .then(() => syncSessionFile(deckId, file, deleted))
  syncQueues.set(deckId, next)
  try {
    return await next
  } finally {
    if (syncQueues.get(deckId) === next) syncQueues.delete(deckId)
  }
}
