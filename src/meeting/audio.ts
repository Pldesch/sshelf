import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"

import { SAMPLE_RATE } from "@/meeting/elevenlabs"
// 100 ms of 16-bit mono PCM at 16 kHz.
const CHUNK_BYTES = (SAMPLE_RATE * 2) / 10

/**
 * Captures mic audio via ffmpeg (macOS AVFoundation) and emits 16 kHz mono
 * s16le PCM chunks of ~100 ms.
 */
export function startMic(
  device: string,
  onChunk: (pcm: Buffer) => void,
  onExit: (err?: string) => void
): ChildProcess {
  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "avfoundation",
      "-i",
      `:${device}`,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  )

  let pending = Buffer.alloc(0)
  ff.stdout.on("data", (data: Buffer) => {
    pending = Buffer.concat([pending, data])
    while (pending.length >= CHUNK_BYTES) {
      onChunk(pending.subarray(0, CHUNK_BYTES))
      pending = pending.subarray(CHUNK_BYTES)
    }
  })

  let stderr = ""
  ff.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
  ff.on("exit", (code, signal) =>
    onExit(
      code === 0 || signal
        ? undefined
        : stderr.trim() || `ffmpeg exited with ${code}`
    )
  )
  return ff
}

export function listDevices(): Promise<string> {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ])
    let out = ""
    ff.stderr.on("data", (d: Buffer) => (out += d.toString()))
    ff.on("exit", () => {
      const audio = out.split("AVFoundation audio devices:")[1] ?? ""
      resolve(
        audio
          .split("\n")
          .map((l) => l.replace(/^\[AVFoundation[^\]]*\]\s*/, "").trim())
          .filter((l) => /^\[\d+\]/.test(l))
          .join("\n")
      )
    })
  })
}
