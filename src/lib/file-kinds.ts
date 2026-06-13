export type FileKind = "markdown" | "pdf" | "image" | "html" | "text" | "other"

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "ico",
  "bmp",
])

const TEXT_EXTENSIONS = new Set([
  "txt",
  "json",
  "jsonl",
  "yml",
  "yaml",
  "csv",
  "tsv",
  "log",
  "css",
  "js",
  "ts",
  "py",
  "sh",
  "toml",
  "xml",
  "env",
])

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function fileKindOf(name: string): FileKind {
  const ext = extensionOf(name)
  if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown"
  if (ext === "pdf") return "pdf"
  if (ext === "html" || ext === "htm") return "html"
  if (IMAGE_EXTENSIONS.has(ext)) return "image"
  if (TEXT_EXTENSIONS.has(ext)) return "text"
  return "other"
}

export function mimeTypeOf(name: string): string {
  const ext = extensionOf(name)
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    ico: "image/x-icon",
    bmp: "image/bmp",
    html: "text/html; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json; charset=utf-8",
  }
  return map[ext] ?? "application/octet-stream"
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return ""
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = ""
  for (const next of units) {
    value /= 1024
    unit = next
    if (value < 1024) break
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
}

export function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestampMs))
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

export function nameOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? path : path.slice(slash + 1)
}

export function rawFileUrl(path: string, download = false): string {
  const params = new URLSearchParams({ path })
  if (download) params.set("download", "1")
  return `/api/raw?${params.toString()}`
}
