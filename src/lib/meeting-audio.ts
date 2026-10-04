/* Browser-side live transcription: mic → AudioWorklet (16 kHz PCM) →
   ElevenLabs Scribe v2 Realtime over a websocket authenticated with
   single-use tokens, so the API key stays on the server. */

import {
  FATAL_STT_ERRORS,
  SAMPLE_RATE,
  audioChunkMessage,
  realtimeUrl,
} from "@/meeting/elevenlabs"

// 100 ms of audio per websocket message.
const CHUNK_SAMPLES = SAMPLE_RATE / 10

const WORKLET = `
class PcmChunker extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK_SAMPLES}); this.n = 0; this.sq = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.sq += s * s
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) {
        this.port.postMessage({ pcm: this.buf.buffer, rms: Math.sqrt(this.sq / this.n) }, [this.buf.buffer])
        this.buf = new Int16Array(${CHUNK_SAMPLES}); this.n = 0; this.sq = 0
      }
    }
    return true
  }
}
registerProcessor("pcm-chunker", PcmChunker)
`

export type SttStatus = "connecting" | "live" | "reconnecting" | "error"

interface SttHandlers {
  onPartial: (text: string) => void
  onCommitted: (text: string) => void
  onStatus: (status: SttStatus, message?: string) => void
  onLevel: (rms: number) => void
}

export interface Capture {
  setMuted: (muted: boolean) => void
  stop: () => Promise<void>
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export async function listMicrophones(): Promise<Array<MediaDeviceInfo>> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === "audioinput")
}

export async function startCapture(
  options: {
    deviceId?: string
    languages: Array<string>
    getToken: () => Promise<string>
  },
  handlers: SttHandlers
): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })
  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  let chunker: AudioWorkletNode
  try {
    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET], { type: "application/javascript" })
    )
    await context.audioWorklet.addModule(workletUrl)
    URL.revokeObjectURL(workletUrl)
    const source = context.createMediaStreamSource(stream)
    chunker = new AudioWorkletNode(context, "pcm-chunker")
    source.connect(chunker)
  } catch (error) {
    // Don't leave the mic open when setup fails halfway.
    for (const track of stream.getTracks()) track.stop()
    await context.close()
    throw error
  }

  let ws: WebSocket | null = null
  let stopped = false
  let muted = false
  let retryMs = 1000
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function retryLater() {
    if (stopped) return
    retryTimer = setTimeout(() => void connect(), retryMs)
    retryMs = Math.min(retryMs * 2, 30_000)
  }

  async function connect() {
    if (stopped) return
    handlers.onStatus(ws ? "reconnecting" : "connecting")
    let token: string
    try {
      token = await options.getToken()
    } catch (error) {
      // Could be a network blip as much as a bad key: show it, keep trying.
      handlers.onStatus("error", (error as Error).message)
      retryLater()
      return
    }
    // `stop()` may have run while the token was being fetched.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (stopped) return

    const socket = new WebSocket(realtimeUrl(options.languages, token))
    ws = socket
    let fatal = false
    socket.onmessage = (event) => {
      let msg: { message_type?: string; text?: string; error?: string }
      try {
        msg = JSON.parse(String(event.data)) as typeof msg
      } catch {
        return
      }
      switch (msg.message_type) {
        case "session_started":
          retryMs = 1000
          handlers.onStatus("live")
          break
        case "partial_transcript":
          handlers.onPartial(msg.text ?? "")
          break
        case "committed_transcript": {
          const text = msg.text?.trim()
          if (text) handlers.onCommitted(text)
          else handlers.onPartial("")
          break
        }
        default:
          if (msg.message_type && FATAL_STT_ERRORS.has(msg.message_type)) {
            fatal = true
            handlers.onStatus("error", msg.error ?? msg.message_type)
          }
      }
    }
    socket.onclose = () => {
      if (stopped || fatal || ws !== socket) return
      handlers.onStatus("reconnecting")
      retryLater()
    }
  }

  chunker.port.onmessage = (
    event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>
  ) => {
    handlers.onLevel(muted ? 0 : event.data.rms)
    if (muted || ws?.readyState !== WebSocket.OPEN) return
    ws.send(audioChunkMessage(toBase64(event.data.pcm)))
  }

  await connect()

  return {
    setMuted: (value) => {
      muted = value
      for (const track of stream.getAudioTracks()) track.enabled = !value
    },
    stop: async () => {
      stopped = true
      clearTimeout(retryTimer)
      const socket = ws
      if (socket?.readyState === WebSocket.OPEN) {
        // Flush whatever was said last before closing.
        socket.send(audioChunkMessage("", true))
        await new Promise((resolve) => setTimeout(resolve, 1500))
        socket.close()
      }
      for (const track of stream.getTracks()) track.stop()
      await context.close()
    },
  }
}
