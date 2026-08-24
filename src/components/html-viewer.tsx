import { useEffect, useRef } from "react"
import { rawFileUrl } from "@/lib/file-kinds"
import {
  HTML_FILE_BRIDGE_CHANNEL,
  parseHtmlFileBridgeRequest,
} from "@/lib/html-file-bridge"
import { readHtmlCompanionFile, writeHtmlCompanionFile } from "@/server/files"
import type { HtmlFileBridgeResponse } from "@/lib/html-file-bridge"

// Renders an HTML file as a live page (sandboxed iframe). The iframe loads
// /api/raw, which already serves the file with a text/html content type, so the
// browser renders it.
export default function HtmlViewer({
  path,
}: {
  path: string
  content: string | null
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const operationQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const request = parseHtmlFileBridgeRequest(event.data)
      if (!request) return

      const respond = (response: HtmlFileBridgeResponse) => {
        iframeRef.current?.contentWindow?.postMessage(response, "*")
      }
      const run = async () => {
        try {
          if (request.type === "read-file") {
            const result = await readHtmlCompanionFile({
              data: { htmlPath: path, path: request.path },
            })
            respond({
              channel: HTML_FILE_BRIDGE_CHANNEL,
              type: "file-result",
              requestId: request.requestId,
              ok: true,
              path: result.path,
              content: result.content,
            })
            return
          }

          const result = await writeHtmlCompanionFile({
            data: {
              htmlPath: path,
              path: request.path,
              content: request.content,
            },
          })
          respond({
            channel: HTML_FILE_BRIDGE_CHANNEL,
            type: "file-result",
            requestId: request.requestId,
            ok: true,
            path: result.path,
          })
        } catch (error) {
          respond({
            channel: HTML_FILE_BRIDGE_CHANNEL,
            type: "file-result",
            requestId: request.requestId,
            ok: false,
            error:
              error instanceof Error ? error.message : "File operation failed",
          })
        }
      }

      // Keep reads and writes ordered so rapid autosaves cannot finish in the
      // opposite order over SSH and restore stale content.
      operationQueue.current = operationQueue.current
        .catch(() => undefined)
        .then(run)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [path])

  return (
    <iframe
      ref={iframeRef}
      src={rawFileUrl(path)}
      title={path}
      // allow-scripts (without allow-same-origin) runs the page's own JS in an
      // opaque origin, so it can't touch the explorer it's embedded in.
      sandbox="allow-scripts allow-popups allow-forms"
      className="min-h-0 flex-1 border-0 bg-white"
    />
  )
}
