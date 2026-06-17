import { createFileRoute } from "@tanstack/react-router"
import { SshError, findEntry, writeRemoteFile } from "@/server/ssh"

/**
 * Turn a client-supplied relative path (a file name, or a
 * `webkitRelativePath` like "folder/sub/file.txt") into clean segments,
 * rejecting anything that could escape the destination folder.
 */
function sanitizeRelativePath(raw: string): Array<string> {
  const segments = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0) {
    throw new Error("A file is missing its name")
  }
  for (const segment of segments) {
    if (segment === ".." || segment.includes("\0")) {
      throw new Error("Invalid file path")
    }
  }
  return segments
}

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let form: FormData
        try {
          form = await request.formData()
        } catch {
          return new Response("Expected multipart form data", { status: 400 })
        }

        const parentPath = String(form.get("parentPath") ?? "")
        const files = form
          .getAll("files")
          .filter((v): v is File => v instanceof File)
        const paths = form.getAll("paths").map((v) => String(v))
        if (files.length === 0) {
          return new Response("No files to upload", { status: 400 })
        }

        try {
          if (parentPath) {
            const parent = await findEntry(parentPath)
            if (!parent.value || parent.value.type !== "dir") {
              return new Response("Destination folder was not found", {
                status: 404,
              })
            }
          }

          let written = 0
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const relative = paths[i] ?? file.name
            const segments = sanitizeRelativePath(relative)
            const targetPath = [parentPath, ...segments]
              .filter(Boolean)
              .join("/")
            const buffer = Buffer.from(await file.arrayBuffer())
            await writeRemoteFile(targetPath, buffer)
            written++
          }

          return Response.json({ ok: true, written })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Upload failed"
          const status = error instanceof SshError ? 502 : 400
          return new Response(message, { status })
        }
      },
    },
  },
})
