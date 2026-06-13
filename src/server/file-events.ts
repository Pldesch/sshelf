import {
  REMOTE_ROOT,
  clearRemoteCache,
  getCurrentHost,
  runRemote,
  shellQuote,
} from "@/server/ssh"

const POLL_INTERVAL_MS = 4_000
const KEEP_ALIVE_INTERVAL_MS = 15_000

interface FileChangeEvent {
  host: string
  fingerprint: string
}

interface Subscriber {
  send: (event: string, data: unknown) => void
}

const subscribers = new Set<Subscriber>()
const fingerprintsByHost = new Map<string, string>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let polling = false

async function fetchRemoteFingerprint(): Promise<FileChangeEvent | null> {
  const host = getCurrentHost()
  if (!host) return null

  const output = await runRemote(
    `find ${shellQuote(REMOTE_ROOT)} -mindepth 1 ` +
      `\\( -path '*/.*' -o -name '.*' -o -name node_modules -o -name __pycache__ -o -name venv -o -name .venv \\) -prune ` +
      `-o -printf '%y\\t%s\\t%T@\\t%P\\n' | sort | sha256sum`
  )
  const fingerprint = output.trim().split(/\s+/)[0]
  return fingerprint ? { host, fingerprint } : null
}

function broadcast(event: string, data: unknown) {
  for (const subscriber of subscribers) subscriber.send(event, data)
}

async function pollRemoteFiles() {
  if (polling || subscribers.size === 0) return
  polling = true
  try {
    const next = await fetchRemoteFingerprint()
    if (!next) return

    const previous = fingerprintsByHost.get(next.host)
    fingerprintsByHost.set(next.host, next.fingerprint)
    if (previous && previous !== next.fingerprint) {
      clearRemoteCache()
      broadcast("files-changed", next)
    }
  } catch {
    // The existing SSH layer marks stale data/offline state on the next read.
  } finally {
    polling = false
  }
}

function startPolling() {
  if (pollTimer) return
  void pollRemoteFiles()
  pollTimer = setInterval(() => void pollRemoteFiles(), POLL_INTERVAL_MS)
}

function stopPollingIfIdle() {
  if (subscribers.size > 0 || !pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

export function createRemoteFileEventStream(
  request: Request
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null
  let closed = false
  let subscriber: Subscriber | null = null
  function cleanup() {
    if (closed) return
    closed = true
    if (keepAliveTimer) clearInterval(keepAliveTimer)
    if (subscriber) subscribers.delete(subscriber)
    stopPollingIfIdle()
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function enqueue(chunk: string) {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }

      subscriber = {
        send(event, data) {
          enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        },
      }
      subscribers.add(subscriber)
      startPolling()

      enqueue("event: ready\ndata: {}\n\n")
      keepAliveTimer = setInterval(() => {
        enqueue(": keep-alive\n\n")
      }, KEEP_ALIVE_INTERVAL_MS)

      request.signal.addEventListener("abort", cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })
}
