import { fileKindOf, parentOf } from "./file-kinds"

export const HTML_FILE_BRIDGE_CHANNEL = "sshelf:file-bridge:v1"

export const MAX_HTML_COMPANION_BYTES = 4 * 1024 * 1024

export type HtmlFileBridgeRequest =
  | {
      channel: typeof HTML_FILE_BRIDGE_CHANNEL
      type: "read-file"
      requestId: string
      path: string
    }
  | {
      channel: typeof HTML_FILE_BRIDGE_CHANNEL
      type: "write-file"
      requestId: string
      path: string
      content: string
    }

export type HtmlFileBridgeResponse = {
  channel: typeof HTML_FILE_BRIDGE_CHANNEL
  type: "file-result"
  requestId: string
  ok: boolean
  path?: string
  content?: string
  error?: string
}

/**
 * Parse a message from a sandboxed HTML preview. Keeping this strict prevents
 * unrelated postMessage traffic from reaching the remote file operations.
 */
export function parseHtmlFileBridgeRequest(
  value: unknown
): HtmlFileBridgeRequest | null {
  if (!value || typeof value !== "object") return null
  const message = value as Record<string, unknown>
  if (
    message.channel !== HTML_FILE_BRIDGE_CHANNEL ||
    (message.type !== "read-file" && message.type !== "write-file") ||
    typeof message.requestId !== "string" ||
    message.requestId.length === 0 ||
    message.requestId.length > 200 ||
    typeof message.path !== "string"
  ) {
    return null
  }
  if (message.type === "write-file" && typeof message.content !== "string") {
    return null
  }
  return message as HtmlFileBridgeRequest
}

/**
 * Resolve a path requested by an HTML preview. Preview code receives a narrow
 * capability: existing text files beside the HTML file or below its directory.
 * Absolute paths and parent traversal are deliberately unavailable.
 */
export function resolveHtmlCompanionPath(
  htmlPath: string,
  requestedPath: string
): string {
  if (fileKindOf(htmlPath) !== "html") {
    throw new Error("The requesting file is not HTML")
  }

  const normalized = requestedPath.replace(/\\/g, "/").trim()
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes("\0")
  ) {
    throw new Error("The companion path must be relative")
  }

  const segments = normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error("The companion path cannot leave the HTML directory")
  }

  const base = parentOf(htmlPath)
  const target = [base, ...segments].filter(Boolean).join("/")
  if (target === htmlPath) {
    throw new Error("An HTML preview cannot overwrite itself")
  }
  return target
}

export function assertEditableHtmlCompanion(path: string): void {
  const kind = fileKindOf(path)
  if (kind !== "text" && kind !== "markdown") {
    throw new Error("HTML previews can only access text companion files")
  }
}
