import { lstatSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, parse, posix } from "node:path"

export type TransportMode = "ssh" | "local"

export interface TransportConfig {
  mode: TransportMode
  root: string
}

interface RuntimeGuard {
  isProduction: boolean
  platform: NodeJS.Platform
}

const DEFAULT_REMOTE_ROOT = "/home/ubuntu"

function defaultRuntimeGuard(): RuntimeGuard {
  const viteEnvironment = (
    import.meta as unknown as { env?: { PROD?: boolean } }
  ).env
  return {
    // Vite replaces import.meta.env.PROD in compiled builds. NODE_ENV is kept
    // as a second runtime guard so a production server also fails closed.
    isProduction:
      Boolean(viteEnvironment?.PROD) || process.env.NODE_ENV === "production",
    platform: process.platform,
  }
}

/**
 * Resolve the server-side command transport once, at process startup. Local
 * mode is deliberately impossible in production and requires a separate,
 * explicit root so an existing SSH root cannot accidentally become local.
 */
export function resolveTransportConfig(
  env: NodeJS.ProcessEnv = process.env,
  runtime: RuntimeGuard = defaultRuntimeGuard()
): TransportConfig {
  const requested = env.SSHELF_TRANSPORT?.trim() || "ssh"
  if (requested !== "ssh" && requested !== "local") {
    throw new Error(
      `Invalid SSHELF_TRANSPORT ${JSON.stringify(requested)}; expected "ssh" or "local"`
    )
  }

  if (requested === "ssh") {
    const root = env.SSHELF_REMOTE_ROOT?.trim() || DEFAULT_REMOTE_ROOT
    if (!posix.isAbsolute(root)) {
      throw new Error("SSHELF_REMOTE_ROOT must be an absolute POSIX path")
    }
    return { mode: "ssh", root }
  }

  if (runtime.isProduction || env.NODE_ENV !== "development") {
    throw new Error(
      "SSHELF_TRANSPORT=local is restricted to an explicit development runtime"
    )
  }
  if (runtime.platform === "win32") {
    throw new Error("SSHELF_TRANSPORT=local currently requires a POSIX host")
  }

  const configuredRoot = env.SSHELF_LOCAL_ROOT?.trim()
  if (!configuredRoot) {
    throw new Error("SSHELF_LOCAL_ROOT is required when SSHELF_TRANSPORT=local")
  }
  if (!isAbsolute(configuredRoot)) {
    throw new Error("SSHELF_LOCAL_ROOT must be an absolute path")
  }

  let root: string
  try {
    root = realpathSync(configuredRoot)
    if (!statSync(root).isDirectory()) throw new Error("not a directory")
  } catch {
    throw new Error("SSHELF_LOCAL_ROOT must be an existing directory")
  }
  if (root === parse(root).root) {
    throw new Error("SSHELF_LOCAL_ROOT cannot be the filesystem root")
  }

  return { mode: "local", root }
}

/** Resolve a workspace-relative path and reject local symlink traversal. */
export function resolveTransportPath(
  relativePath: string,
  config: TransportConfig
): string {
  if (relativePath.includes("\0")) throw new Error("Invalid path")
  const segments = relativePath
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Invalid path")
  }

  if (config.mode === "ssh") {
    const joined = segments.join("/")
    return joined ? posix.join(config.root, joined) : config.root
  }

  const absolute = join(config.root, ...segments)
  let cursor = config.root
  for (const segment of segments) {
    cursor = join(cursor, segment)
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error("Invalid path")
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        // A new path may not exist yet. Its nearest existing ancestor has
        // already been checked, and later segments cannot be symlinks yet.
        break
      }
      throw error
    }
  }
  return absolute
}

export const TRANSPORT_CONFIG = resolveTransportConfig()
export const LOCAL_TARGET_ALIAS = "local"
