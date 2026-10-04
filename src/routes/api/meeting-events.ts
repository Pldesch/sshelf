import { createFileRoute } from "@tanstack/react-router"
import { getMeeting, subscribe } from "@/server/meeting-sessions"
import type { MeetingEvent } from "@/lib/meeting-types"

/* Server-sent events for one meeting. Reconnects resume after the last
   event the page saw (Last-Event-ID or ?after=). */
export const Route = createFileRoute("/api/meeting-events")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const meeting = getMeeting(url.searchParams.get("id") ?? "")
        const after = Number(
          request.headers.get("Last-Event-ID") ??
            url.searchParams.get("after") ??
            0
        )
        const encoder = new TextEncoder()
        let closed = false
        let unsubscribe = () => {}
        let heartbeat: ReturnType<typeof setInterval> | undefined
        function cleanup() {
          if (closed) return
          closed = true
          unsubscribe()
          clearInterval(heartbeat)
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const write = (chunk: string) => {
              if (!closed) controller.enqueue(encoder.encode(chunk))
            }
            // Live-only events (seq 0) carry no id, so they don't move the
            // page's Last-Event-ID.
            const send = (event: MeetingEvent) =>
              write(
                `${event.seq ? `id: ${event.seq}\n` : ""}event: meeting\ndata: ${JSON.stringify(event)}\n\n`
              )
            unsubscribe = subscribe(meeting, after, send)
            heartbeat = setInterval(() => write(": ping\n\n"), 15_000)
            request.signal.addEventListener(
              "abort",
              () => {
                cleanup()
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              },
              { once: true }
            )
          },
          cancel: cleanup,
        })

        return new Response(stream, {
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
