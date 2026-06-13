import { createFileRoute } from "@tanstack/react-router"
import { createRemoteFileEventStream } from "@/server/file-events"

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return new Response(createRemoteFileEventStream(request), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        })
      },
    },
  },
})
