import * as React from "react"
import {
  CheckIcon,
  LoaderIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  prepareEstradeckSession,
  syncEstradeckSession,
} from "@/server/estradeck-functions"
import type {
  EstradeckSession,
  EstradeckSyncResult,
} from "@/server/estradeck-functions"

const CHANNEL = "sshelf:estradeck:v1"
const READY_TIMEOUT_MS = 15_000

type SyncStatus = "loading" | "ready" | "saving" | "saved" | "error"

interface EstradeckMessage {
  channel: typeof CHANNEL
  type: "ready" | "deck-changed"
  deckId?: string
  file?: string
  deleted?: boolean
}

function isolatedEditorUrl(editorUrl: string): URL | null {
  const url = new URL(editorUrl, window.location.href)
  if (editorUrl.startsWith("/")) {
    if (url.hostname === "localhost") url.hostname = "127.0.0.1"
    else if (url.hostname === "127.0.0.1") url.hostname = "localhost"
  }
  return url.origin === window.location.origin ? null : url
}

function isEstradeckMessage(value: unknown): value is EstradeckMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return (
    message.channel === CHANNEL &&
    (message.type === "ready" || message.type === "deck-changed")
  )
}

export default function EstradeckEditor({
  path,
  fallback,
  onSynced,
}: {
  path: string
  fallback: React.ReactNode
  onSynced: (result: EstradeckSyncResult) => void
}) {
  const [session, setSession] = React.useState<EstradeckSession | null>(null)
  const [status, setStatus] = React.useState<SyncStatus>("loading")
  const [error, setError] = React.useState<string | null>(null)
  const [useFallback, setUseFallback] = React.useState(false)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    let cancelled = false
    setSession(null)
    setStatus("loading")
    setError(null)
    setUseFallback(false)
    void prepareEstradeckSession({ data: { path } })
      .then((prepared) => {
        if (cancelled) return
        if (!prepared.available) {
          setUseFallback(true)
          setError(prepared.reason ?? "Estradeck is unavailable")
          return
        }
        setSession(prepared)
      })
      .catch((cause) => {
        if (cancelled) return
        setUseFallback(true)
        setError(
          cause instanceof Error ? cause.message : "Could not open Estradeck"
        )
      })
    return () => {
      cancelled = true
    }
  }, [path])

  React.useEffect(() => {
    if (!session?.editorUrl || !session.deckId) return
    const deckId = session.deckId
    const editorUrl = isolatedEditorUrl(session.editorUrl)
    if (!editorUrl) {
      setError("Estradeck must use an isolated origin")
      setUseFallback(true)
      return
    }
    const editorOrigin = editorUrl.origin
    let disposed = false
    let ready = false
    const timeout = window.setTimeout(() => {
      if (disposed || ready) return
      setError("Estradeck did not start. Is the development service running?")
      setUseFallback(true)
    }, READY_TIMEOUT_MS)

    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== editorOrigin ||
        event.source !== iframeRef.current?.contentWindow ||
        !isEstradeckMessage(event.data)
      ) {
        return
      }
      if (event.data.deckId && event.data.deckId !== deckId) return
      if (event.data.type === "ready") {
        ready = true
        window.clearTimeout(timeout)
        setStatus("ready")
        return
      }
      if (!event.data.file) return
      setStatus("saving")
      setError(null)
      void syncEstradeckSession({
        data: {
          deckId,
          file: event.data.file,
          deleted: event.data.deleted === true,
        },
      })
        .then((result) => {
          if (disposed) return
          setStatus("saved")
          onSynced(result)
        })
        .catch((cause) => {
          if (disposed) return
          setStatus("error")
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not save the Estradeck changes"
          )
        })
    }
    window.addEventListener("message", onMessage)
    return () => {
      disposed = true
      window.clearTimeout(timeout)
      window.removeEventListener("message", onMessage)
    }
  }, [onSynced, session])

  if (useFallback) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {error && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <TriangleAlertIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{error}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              <RotateCcwIcon /> Retry Estradeck
            </Button>
          </div>
        )}
        {fallback}
      </div>
    )
  }

  const editorUrl = session?.editorUrl
    ? isolatedEditorUrl(session.editorUrl)
    : null

  return (
    <div className="relative flex min-h-0 flex-1 bg-[var(--navy-900)]">
      {editorUrl ? (
        <iframe
          ref={iframeRef}
          src={editorUrl.toString()}
          title={`Edit ${path} in Estradeck`}
          allow="fullscreen"
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-[#0d1117]"
        />
      ) : null}
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--navy-900)] text-sm text-white">
          <span className="flex items-center gap-2">
            <LoaderIcon className="size-4 animate-spin" /> Opening Estradeck…
          </span>
        </div>
      )}
      {status !== "loading" && (
        <div
          className={`pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs shadow-sm ${
            status === "error"
              ? "bg-red-50 text-red-700"
              : "bg-white/90 text-[var(--navy-700)]"
          }`}
          title={error ?? undefined}
        >
          {status === "saving" ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : status === "error" ? (
            <TriangleAlertIcon className="size-3.5" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {status === "saving"
            ? "Saving to Sshelf…"
            : status === "error"
              ? "Couldn’t sync"
              : "Synced with Sshelf"}
        </div>
      )}
    </div>
  )
}
