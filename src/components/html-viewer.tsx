import { rawFileUrl } from "@/lib/file-kinds"

// Renders an HTML file as a live page (sandboxed iframe). The iframe loads
// /api/raw, which already serves the file with a text/html content type, so the
// browser renders it.
export default function HtmlViewer({
  path,
}: {
  path: string
  content: string | null
}) {
  return (
    <iframe
      src={rawFileUrl(path)}
      title={path}
      // allow-scripts (without allow-same-origin) runs the page's own JS in an
      // opaque origin, so it can't touch the explorer it's embedded in.
      sandbox="allow-scripts allow-popups allow-forms"
      className="min-h-0 flex-1 border-0 bg-white"
    />
  )
}
