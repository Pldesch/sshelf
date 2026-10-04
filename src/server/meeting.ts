import { createServerFn } from "@tanstack/react-start"
import { readElevenLabsKey, writeElevenLabsKey } from "@/server/elevenlabs-key"
import {
  addSegment,
  ask,
  endMeeting,
  getMeeting,
  ingest,
  startMeeting,
  stopClaude,
} from "@/server/meeting-sessions"
import { getCurrentHost } from "@/server/ssh"
import type {
  MeetingInfo,
  MeetingSegment,
  SessionKind,
} from "@/lib/meeting-types"

/* Server functions behind the meeting page. The ElevenLabs key never
   reaches the browser: the page streams audio with single-use tokens. */

async function requestSttToken(key: string): Promise<string> {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    { method: "POST", headers: { "xi-api-key": key } }
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      detail?: { message?: string }
    } | null
    throw new Error(
      body?.detail?.message ??
        `ElevenLabs refused the request (${response.status})`
    )
  }
  return ((await response.json()) as { token: string }).token
}

export const getMeetingSetup = createServerFn().handler(() => {
  const key = readElevenLabsKey()
  return {
    host: getCurrentHost(),
    apiKey: key && { last4: key.slice(-4) },
  }
})

/* Server functions are reachable by anything that can POST to the app, so
   inputs are checked at runtime, not just typed. */
function text(value: unknown, name: string, max = 20_000): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request")
  }
  return value as Record<string, unknown>
}

function sessionKind(value: unknown): SessionKind {
  if (value !== "meeting" && value !== "ingest") {
    throw new Error("Invalid session")
  }
  return value
}

/** Check the key against ElevenLabs before saving it, so a key without the
 * Speech to Text permission is caught here rather than mid-meeting. */
export const saveElevenLabsKey = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string }) => ({
    key: text(object(data).key, "API key", 500),
  }))
  .handler(async ({ data }) => {
    const key = data.key.trim()
    if (!key) throw new Error("Enter an API key")
    await requestSttToken(key)
    writeElevenLabsKey(key)
    return { ok: true }
  })

export const removeElevenLabsKey = createServerFn({ method: "POST" }).handler(
  () => {
    writeElevenLabsKey(null)
    return { ok: true }
  }
)

/** A single-use token for one ElevenLabs realtime transcription session. */
export const getSttToken = createServerFn({ method: "POST" }).handler(
  async () => {
    const key = readElevenLabsKey()
    if (!key) throw new Error("Add your ElevenLabs API key on the Meeting page")
    return { token: await requestSttToken(key) }
  }
)

export const startMeetingFn = createServerFn({ method: "POST" })
  .inputValidator((data: { title: string; folder: string }) => {
    const input = object(data)
    return {
      title: text(input.title, "title", 200),
      folder: text(input.folder, "folder", 500),
    }
  })
  .handler(({ data }): MeetingInfo => {
    if (!getCurrentHost()) throw new Error("Pick an SSH host first")
    const meeting = startMeeting(data.title, data.folder)
    return {
      id: meeting.id,
      title: meeting.title,
      transcriptPath: meeting.transcriptPath,
    }
  })

export const addSegmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; segment: MeetingSegment }) => {
    const input = object(data)
    const segment = object(input.segment)
    if (!Number.isInteger(segment.seq) || (segment.seq as number) < 1) {
      throw new Error("Invalid segment")
    }
    return {
      id: text(input.id, "meeting", 100),
      segment: {
        seq: segment.seq as number,
        at: text(segment.at, "segment time", 40),
        text: text(segment.text, "segment"),
      },
    }
  })
  .handler(({ data }) => {
    addSegment(getMeeting(data.id), data.segment)
    return { ok: true }
  })

export const askClaudeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; request: string; upToSeq: number }) => {
    const input = object(data)
    if (!Number.isInteger(input.upToSeq)) throw new Error("Invalid request")
    return {
      id: text(input.id, "meeting", 100),
      request: text(input.request, "request"),
      upToSeq: input.upToSeq as number,
    }
  })
  .handler(({ data }) => ask(getMeeting(data.id), data.request, data.upToSeq))

/** Start ingesting an ended meeting, or reply in the ingest conversation. */
export const ingestMeetingFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; reply?: string }) => {
    const input = object(data)
    return {
      id: text(input.id, "meeting", 100),
      reply: input.reply === undefined ? undefined : text(input.reply, "reply"),
    }
  })
  .handler(({ data }) => ingest(getMeeting(data.id), data.reply))

export const stopClaudeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; kind: SessionKind }) => {
    const input = object(data)
    return { id: text(input.id, "meeting", 100), kind: sessionKind(input.kind) }
  })
  .handler(async ({ data }) => {
    await stopClaude(getMeeting(data.id), data.kind)
    return { ok: true }
  })

export const endMeetingFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({
    id: text(object(data).id, "meeting", 100),
  }))
  .handler(async ({ data }) => {
    await endMeeting(getMeeting(data.id))
    return { ok: true }
  })
