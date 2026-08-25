import { createFileRoute } from "@tanstack/react-router"
import { findEntry, streamRemoteFile } from "@/server/ssh"
import { mimeTypeOf, nameOf } from "@/lib/file-kinds"
import { parseByteRange } from "@/lib/http-range"

export const Route = createFileRoute("/api/raw")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const path = url.searchParams.get("path")
        if (!path) {
          return new Response("Missing path", { status: 400 })
        }
        try {
          const found = await findEntry(path)
          if (!found.value || found.value.type !== "file") {
            return new Response("Not a file", { status: 404 })
          }
          // Cheap revalidation: same size + mtime → browser keeps its copy.
          const etag = `"${found.value.size}-${found.value.modifiedAt}"`
          const headers: Record<string, string> = {
            ETag: etag,
            "Cache-Control": "private, max-age=60",
            "Accept-Ranges": "bytes",
            // Prevent the browser from MIME-sniffing the response into a
            // different (potentially executable) type than we declare.
            "X-Content-Type-Options": "nosniff",
          }
          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, { status: 304, headers })
          }
          const range = parseByteRange(
            request.headers.get("range"),
            found.value.size
          )
          if (range === "invalid") {
            return new Response("Requested range is not satisfiable", {
              status: 416,
              headers: {
                ...headers,
                "Content-Range": `bytes */${found.value.size}`,
              },
            })
          }
          const fileName = nameOf(path)
          const disposition =
            url.searchParams.get("download") === "1" ? "attachment" : "inline"
          const contentType = mimeTypeOf(fileName)
          const responseHeaders: Record<string, string> = {
            ...headers,
            "Content-Type": contentType,
            "Content-Length": String(
              range ? range.end - range.start + 1 : found.value.size
            ),
            "Content-Disposition": `${disposition}; filename="${encodeURIComponent(fileName)}"`,
          }
          // For HTML we keep serving it inline (the html-viewer preview embeds
          // it in a sandboxed iframe that still needs scripts). The CSP sandbox
          // directive forces the document into an opaque origin even on a
          // top-level navigation, so a crafted .html can no longer reach the
          // app's real origin, cookies, or storage — while its own scripts
          // still run inside the isolated context.
          if (contentType.startsWith("text/html")) {
            responseHeaders["Content-Security-Policy"] =
              "sandbox allow-scripts allow-popups allow-forms"
          }
          if (range) {
            responseHeaders["Content-Range"] =
              `bytes ${range.start}-${range.end}/${found.value.size}`
          }
          return new Response(
            streamRemoteFile(path, range || undefined, request.signal),
            {
              status: range ? 206 : 200,
              headers: responseHeaders,
            }
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to read file"
          return new Response(message, { status: 502 })
        }
      },
    },
  },
})
