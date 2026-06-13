import { createServerFn } from "@tanstack/react-start"
import {
  SshError,
  clearRemoteCache,
  fetchTree,
  findEntry,
  getCurrentHost,
  listRemoteDir,
  listSshConfigHosts,
  persistSshHost,
  readRemoteFile,
  resolveRemotePath,
  runRemote,
  searchRemote,
  setSshHost,
  shellQuote,
  sortEntries,
  writeRemoteFile,
} from "@/server/ssh"
import { fileKindOf, nameOf, parentOf } from "@/lib/file-kinds"
import type { RemoteEntry, SearchResult, SshConfigHost } from "@/server/ssh"

const MAX_TEXT_BYTES = 4 * 1024 * 1024

export interface DirectoryView {
  kind: "dir"
  path: string
  entries: Array<RemoteEntry>
  /** True when the server is unreachable and this is the last saved copy. */
  stale: boolean
}

export interface FileView {
  kind: "file"
  path: string
  size: number
  modifiedAt: number
  /** Present for markdown and text files small enough to render inline. */
  content: string | null
  stale: boolean
}

export type BrowseResult = DirectoryView | FileView

export interface TreeResult {
  entries: Array<RemoteEntry>
  stale: boolean
  host: string | null
}

export const getTree = createServerFn().handler(
  async (): Promise<TreeResult> => {
    const tree = await fetchTree()
    return {
      entries: sortEntries([...tree.value]),
      stale: tree.stale,
      host: getCurrentHost(),
    }
  }
)

export interface SshHostsResult {
  hosts: Array<SshConfigHost>
  current: string | null
}

export const getSshHosts = createServerFn().handler(
  async (): Promise<SshHostsResult> => ({
    hosts: listSshConfigHosts(),
    current: getCurrentHost(),
  })
)

export const selectSshHost = createServerFn({ method: "POST" })
  .inputValidator((data: { host: string }) => data)
  .handler(async ({ data }) => {
    const known = listSshConfigHosts().some((h) => h.alias === data.host)
    if (!known) {
      throw new Error(`"${data.host}" is not in your ~/.ssh/config`)
    }
    // Probe before committing so a bad pick never strands the app.
    const previous = getCurrentHost()
    setSshHost(data.host)
    try {
      await runRemote("echo ok")
    } catch (error) {
      setSshHost(previous)
      const detail =
        error instanceof Error ? error.message : "connection failed"
      throw new Error(`Could not connect to "${data.host}" — ${detail}`)
    }
    persistSshHost(data.host)
    return { ok: true, host: data.host }
  })

export const browsePath = createServerFn()
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<BrowseResult> => {
    if (data.path === "") {
      const listing = await listRemoteDir("")
      return {
        kind: "dir",
        path: "",
        entries: listing.value,
        stale: listing.stale,
      }
    }

    const found = await findEntry(data.path)
    if (!found.value) {
      throw new SshError(`"${data.path}" was not found on the server`)
    }
    const entry = found.value

    if (entry.type === "dir") {
      const listing = await listRemoteDir(data.path)
      return {
        kind: "dir",
        path: data.path,
        entries: listing.value,
        stale: listing.stale || found.stale,
      }
    }

    const kind = fileKindOf(data.path)
    let content: string | null = null
    let stale = found.stale
    if (
      (kind === "markdown" || kind === "text" || kind === "html") &&
      entry.size <= MAX_TEXT_BYTES
    ) {
      const file = await readRemoteFile(data.path)
      content = file.value.toString("utf-8")
      stale = stale || file.stale
    }
    return {
      kind: "file",
      path: data.path,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      content,
      stale,
    }
  })

export const saveFile = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; content: string }) => data)
  .handler(async ({ data }) => {
    if (!data.path) throw new Error("No file selected")
    // The editor only supports markdown — refuse anything else so a
    // stray request can never overwrite a binary or config file.
    if (fileKindOf(data.path) !== "markdown") {
      throw new Error("Only markdown files can be edited here")
    }
    const found = await findEntry(data.path)
    if (!found.value) {
      throw new SshError(`"${data.path}" was not found on the server`)
    }
    if (found.value.type !== "file") {
      throw new Error("Only files can be edited")
    }
    await writeRemoteFile(data.path, Buffer.from(data.content, "utf-8"))
    return { ok: true }
  })

export const deletePath = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }) => {
    if (!data.path) throw new Error("The root folder cannot be deleted")
    const found = await findEntry(data.path)
    if (!found.value) {
      throw new SshError(`"${data.path}" was not found on the server`)
    }
    const absolute = resolveRemotePath(data.path)
    const flags = found.value.type === "dir" ? "-rf" : "-f"
    await runRemote(`rm ${flags} ${shellQuote(absolute)}`)
    // Listings and contents are now wrong — refetch on next request.
    clearRemoteCache()
    return { ok: true }
  })

function validateEntryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Name cannot be empty")
  if (trimmed === "." || trimmed === ".." || trimmed.includes("/")) {
    throw new Error("Name cannot contain path separators")
  }
  if (trimmed.includes("\0")) throw new Error("Name cannot contain null bytes")
  return trimmed
}

export const createFolder = createServerFn({ method: "POST" })
  .inputValidator((data: { parentPath: string; name: string }) => data)
  .handler(async ({ data }) => {
    const name = validateEntryName(data.name)
    if (data.parentPath) {
      const parent = await findEntry(data.parentPath)
      if (!parent.value || parent.value.type !== "dir") {
        throw new Error("Destination folder was not found")
      }
    }
    const nextPath = data.parentPath ? `${data.parentPath}/${name}` : name
    const absolute = resolveRemotePath(nextPath)
    await runRemote(
      `if [ -e ${shellQuote(absolute)} ]; then ` +
        `printf '%s\\n' 'An item with that name already exists' >&2; exit 1; ` +
        `fi; mkdir ${shellQuote(absolute)}`
    )
    clearRemoteCache()
    return { ok: true, path: nextPath }
  })

async function moveWithoutOverwrite(fromPath: string, toPath: string) {
  const fromAbsolute = resolveRemotePath(fromPath)
  const toAbsolute = resolveRemotePath(toPath)
  await runRemote(
    `if [ -e ${shellQuote(toAbsolute)} ]; then ` +
      `printf '%s\\n' 'An item with that name already exists' >&2; exit 1; ` +
      `fi; mv ${shellQuote(fromAbsolute)} ${shellQuote(toAbsolute)}`
  )
  clearRemoteCache()
}

export const renameFile = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; name: string }) => data)
  .handler(async ({ data }) => {
    const nextName = validateEntryName(data.name)
    const found = await findEntry(data.path)
    if (!found.value) {
      throw new SshError(`"${data.path}" was not found on the server`)
    }
    if (found.value.type !== "file") {
      throw new Error("Only files can be renamed from this menu")
    }

    const parent = parentOf(data.path)
    const nextPath = parent ? `${parent}/${nextName}` : nextName
    if (nextPath === data.path) return { ok: true, path: nextPath }

    await moveWithoutOverwrite(data.path, nextPath)
    return { ok: true, path: nextPath }
  })

async function moveEntryToParent(data: {
  path: string
  parentPath: string
  expectedType?: "dir" | "file"
}) {
  if (!data.path) throw new Error("The root folder cannot be moved")
  const found = await findEntry(data.path)
  if (!found.value) {
    throw new SshError(`"${data.path}" was not found on the server`)
  }
  if (data.expectedType && found.value.type !== data.expectedType) {
    throw new Error(
      data.expectedType === "dir"
        ? "Only folders can be moved from this menu"
        : "Only files can be moved from this menu"
    )
  }

  const targetParentPath = data.parentPath
  const targetParent = targetParentPath
    ? await findEntry(targetParentPath)
    : { value: { type: "dir" } }
  if (!targetParent.value || targetParent.value.type !== "dir") {
    throw new Error("Destination folder was not found")
  }
  if (
    found.value.type === "dir" &&
    (targetParentPath === data.path ||
      targetParentPath.startsWith(`${data.path}/`))
  ) {
    throw new Error("A folder cannot be moved inside itself")
  }

  const currentParent = parentOf(data.path)
  if (targetParentPath === currentParent) {
    return { ok: true, path: data.path }
  }

  const nextPath = targetParentPath
    ? `${targetParentPath}/${nameOf(data.path)}`
    : nameOf(data.path)

  await moveWithoutOverwrite(data.path, nextPath)
  return { ok: true, path: nextPath }
}

export const moveEntry = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; parentPath: string }) => data)
  .handler(async ({ data }) => {
    return moveEntryToParent(data)
  })

export const moveFolder = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; parentPath: string }) => data)
  .handler(async ({ data }) => {
    return moveEntryToParent({ ...data, expectedType: "dir" })
  })

export const searchFiles = createServerFn()
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<Array<SearchResult>> => {
    return searchRemote(data.query)
  })
