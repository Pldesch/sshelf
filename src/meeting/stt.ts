import WebSocket from "ws"
import {
  FATAL_STT_ERRORS,
  audioChunkMessage,
  realtimeUrl,
} from "@/meeting/elevenlabs"

interface SttEvents {
  onPartial: (text: string) => void
  onCommitted: (text: string) => void
  onStatus: (msg: string) => void
  /** Unrecoverable error (bad key, no quota); the client stops reconnecting. */
  onFatal: (msg: string) => void
}

/**
 * ElevenLabs Scribe v2 Realtime client. Uses VAD commits so each pause in
 * speech produces a committed segment. Reconnects on unexpected close; audio
 * sent while disconnected is dropped.
 */
export class ElevenLabsStt {
  private ws?: WebSocket
  private closing = false
  private retryMs = 1000

  constructor(
    private apiKey: string,
    private events: SttEvents,
    /** First entry is the main language, the rest are passed as secondary languages. */
    private languages: string[] = []
  ) {}

  connect() {
    const ws = new WebSocket(realtimeUrl(this.languages), {
      headers: { "xi-api-key": this.apiKey },
    })
    this.ws = ws

    ws.on("message", (raw) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      switch (msg.message_type) {
        case "session_started":
          this.retryMs = 1000
          this.events.onStatus("ElevenLabs session started")
          break
        case "partial_transcript":
          this.events.onPartial(msg.text ?? "")
          break
        case "committed_transcript":
          if (msg.text?.trim()) this.events.onCommitted(msg.text.trim())
          else this.events.onPartial("")
          break
        default:
          if (FATAL_STT_ERRORS.has(msg.message_type)) {
            this.closing = true
            const hint =
              msg.message_type === "auth_error"
                ? " (check the API key is valid and has the Speech to Text permission)"
                : ""
            this.events.onFatal(
              `ElevenLabs ${msg.message_type}: ${msg.error ?? msg.message ?? JSON.stringify(msg)}${hint}`
            )
          } else if (
            /error|exceeded|throttled/i.test(msg.message_type ?? "") &&
            !this.closing
          ) {
            this.events.onStatus(
              `ElevenLabs ${msg.message_type}: ${msg.error ?? msg.message ?? JSON.stringify(msg)}`
            )
          }
      }
    })
    ws.on("error", (err) =>
      this.events.onStatus(`ElevenLabs socket error: ${err.message}`)
    )
    ws.on("close", (code, reason) => {
      if (this.closing) return
      this.events.onStatus(
        `ElevenLabs closed (${code} ${reason.toString()}), reconnecting in ${this.retryMs / 1000}s`
      )
      setTimeout(() => this.connect(), this.retryMs)
      this.retryMs = Math.min(this.retryMs * 2, 30_000)
    })
  }

  send(pcm: Buffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(audioChunkMessage(pcm.toString("base64")))
  }

  /** Force-commit whatever is buffered, give the server a moment to answer, then close. */
  async close() {
    this.closing = true
    const ws = this.ws
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(audioChunkMessage("", true))
    await new Promise((r) => setTimeout(r, 1500))
    ws.close()
  }
}
