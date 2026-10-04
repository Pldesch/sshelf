import * as React from "react"
import { startCapture } from "@/lib/meeting-audio"
import { DEFAULT_TRIGGER_RE, findTrigger } from "@/meeting/trigger"
import { TYPED_PREFIX } from "@/lib/meeting-types"
import {
  addSegmentFn,
  askClaudeFn,
  endMeetingFn,
  getSttToken,
  ingestMeetingFn,
  startMeetingFn,
  stopClaudeFn,
} from "@/server/meeting"
import type { Capture, SttStatus } from "@/lib/meeting-audio"
import type {
  MeetingEvent,
  MeetingInfo,
  MeetingSegment,
  SessionKind,
} from "@/lib/meeting-types"

/* The live meeting, kept outside React so recording carries on while the
   user browses files. The timeline alternates transcript stretches with the
   requests cut out of them, each request carrying Claude's answer. After the
   meeting, the same timeline carries the conversation that ingests it. */

export interface TranscriptBlock {
  kind: "transcript"
  id: string
  segments: Array<MeetingSegment>
}

export interface PromptBlock {
  kind: "prompt"
  id: string
  /** Which Claude session the request goes to. */
  target: SessionKind
  /** Segments cut out of the transcript: the trigger and the request. */
  segments: Array<MeetingSegment>
  request: string
  typed: boolean
  state: "listening" | "sending" | "sent" | "failed"
  askId?: string
  sentAt?: number
  /** Sent while Claude was still working on an earlier request. */
  steering: boolean
  /** A later request was folded into the same answer. */
  redirected: boolean
  activity: Array<string>
  answer?: {
    ok: boolean
    text: string
    costUsd?: number
    durationMs?: number
  }
  error?: string
}

type Block = TranscriptBlock | PromptBlock

export interface MeetingState {
  phase: "idle" | "starting" | "live" | "ending" | "ended"
  info: MeetingInfo | null
  blocks: Array<Block>
  partial: string
  muted: boolean
  stt: { status: SttStatus | "off"; message?: string }
  syncError: string | null
  error: string | null
  startedAt: number | null
  savedPath: string | null
  ingest: {
    /** Workspace-relative folder Claude ingests from, once the meeting ended. */
    dir: string | null
    started: boolean
    resumeCommand?: string
  }
}

const REQUEST_SETTLE_MS = 2500
const EMPTY_REQUEST_WAIT_MS = 10_000

const initialState: MeetingState = {
  phase: "idle",
  info: null,
  blocks: [],
  partial: "",
  muted: false,
  stt: { status: "off" },
  syncError: null,
  error: null,
  startedAt: null,
  savedPath: null,
  ingest: { dir: null, started: false },
}

let state = initialState
const listeners = new Set<() => void>()
let capture: Capture | null = null
let events: EventSource | null = null
let nextSeq = 1
let nextBlockId = 1
let settleTimer: ReturnType<typeof setTimeout> | undefined
const triggerRe = DEFAULT_TRIGGER_RE
// Segment uploads, chained so they reach the server in order and before any
// request or End that depends on them.
let segmentUploads: Promise<void> = Promise.resolve()

// The mic level changes ~10×/s; it lives apart from the meeting state so only
// the level meter re-renders for it.
let level = 0
const levelListeners = new Set<() => void>()
function setLevel(next: number) {
  if (Math.abs(next - level) < 0.004) return
  level = next
  for (const listener of levelListeners) listener()
}

function set(patch: Partial<MeetingState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function updateBlocks(fn: (blocks: Array<Block>) => Array<Block>) {
  set({ blocks: fn(state.blocks) })
}

function updatePrompt(
  match: (block: PromptBlock) => boolean,
  fn: (block: PromptBlock) => PromptBlock
) {
  updateBlocks((blocks) =>
    blocks.map((b) => (b.kind === "prompt" && match(b) ? fn(b) : b))
  )
}

const blockId = () => `b${nextBlockId++}`

function listeningPrompt(): PromptBlock | undefined {
  const last = state.blocks.at(-1)
  return last?.kind === "prompt" && last.state === "listening"
    ? last
    : undefined
}

/* ── Transcript and trigger handling ── */

function onCommitted(text: string) {
  set({ partial: "" })
  // Speech before the trigger in the same segment stays in the transcript.
  const match = triggerRe.exec(text)
  const before = match ? text.slice(0, match.index).trim() : ""
  if (match && before) {
    handleSegment(recordSegment(before))
    handleSegment(recordSegment(text.slice(match.index)))
  } else {
    handleSegment(recordSegment(text))
  }
}

function recordSegment(text: string): MeetingSegment {
  const segment: MeetingSegment = {
    seq: nextSeq++,
    at: new Date().toISOString(),
    text,
  }
  uploadSegment(segment)
  return segment
}

function uploadSegment(segment: MeetingSegment) {
  const id = state.info?.id
  if (!id) return
  segmentUploads = segmentUploads.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await addSegmentFn({ data: { id, segment } })
        return
      } catch (error) {
        // Retrying can't help once the meeting is gone or over.
        if (/no longer open|has ended/i.test((error as Error).message)) {
          set({ syncError: (error as Error).message })
          return
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1))
        )
      }
    }
    set({ syncError: "Some transcript lines could not be saved." })
  })
}

function handleSegment(segment: MeetingSegment) {
  const { text } = segment
  const afterTrigger = findTrigger(text, triggerRe)
  const capturing = listeningPrompt()
  if (afterTrigger !== null) {
    // A new trigger while still capturing one: send that one now.
    if (capturing) void sendPrompt(capturing.id)
    // Cut: the trigger segment leaves the transcript and opens a request.
    updateBlocks((blocks) => [
      ...blocks,
      {
        kind: "prompt",
        id: blockId(),
        target: "meeting",
        segments: [segment],
        request: afterTrigger,
        typed: false,
        state: "listening",
        steering: false,
        redirected: false,
        activity: [],
      },
    ])
    armSettle()
  } else if (capturing) {
    updatePrompt(
      (b) => b.id === capturing.id,
      (b) => ({
        ...b,
        segments: [...b.segments, segment],
        request: `${b.request} ${text}`.trim(),
      })
    )
    armSettle()
  } else {
    appendToTranscript(segment)
  }
}

function appendToTranscript(segment: MeetingSegment) {
  updateBlocks((blocks) => {
    const last = blocks.at(-1)
    if (last?.kind === "transcript") {
      return [
        ...blocks.slice(0, -1),
        { ...last, segments: [...last.segments, segment] },
      ]
    }
    return [
      ...blocks,
      { kind: "transcript", id: blockId(), segments: [segment] },
    ]
  })
}

/** Wait for the speaker to finish the request before sending it. */
function armSettle() {
  clearTimeout(settleTimer)
  const capturing = listeningPrompt()
  if (!capturing) return
  const wait = capturing.request.trim()
    ? REQUEST_SETTLE_MS
    : EMPTY_REQUEST_WAIT_MS
  settleTimer = setTimeout(() => void sendPrompt(capturing.id), wait)
}

async function sendPrompt(id: string) {
  const block = state.blocks.find(
    (b): b is PromptBlock => b.kind === "prompt" && b.id === id
  )
  if (!block || block.state !== "listening" || !state.info) return
  clearTimeout(settleTimer)
  updatePrompt(
    (b) => b.id === id,
    (b) => ({ ...b, state: "sending" })
  )
  const upToSeq = block.segments.at(-1)?.seq ?? nextSeq - 1
  const meetingId = state.info.id
  try {
    // The server must have every segment Claude is meant to see.
    if (block.target === "meeting") await segmentUploads
    const { askId, steering } =
      block.target === "ingest"
        ? await ingestMeetingFn({
            // The first ingest block starts the session; typed ones reply.
            data: {
              id: meetingId,
              reply: block.typed ? block.request : undefined,
            },
          })
        : await askClaudeFn({
            data: { id: meetingId, request: block.request, upToSeq },
          })
    updatePrompt(
      (b) => b.id === id,
      (b) => ({ ...b, state: "sent", askId, steering, sentAt: Date.now() })
    )
  } catch (error) {
    updatePrompt(
      (b) => b.id === id,
      (b) => ({ ...b, state: "failed", error: (error as Error).message })
    )
  }
}

/* ── Server events ── */

function onEvent(event: MeetingEvent) {
  switch (event.type) {
    case "activity": {
      const target = event.askIds.at(-1)
      updatePrompt(
        (b) => b.askId === target,
        (b) => ({ ...b, activity: [...b.activity, event.text].slice(-20) })
      )
      break
    }
    case "answer": {
      const target = event.askIds.at(-1)
      const folded = new Set(event.askIds.slice(0, -1))
      updateBlocks((blocks) =>
        blocks.map((b) => {
          if (b.kind !== "prompt" || !b.askId) return b
          if (b.askId === target) {
            const { text, ok, costUsd, durationMs } = event
            // A second answer for the same request is shown after the first.
            const previous = b.answer
            return {
              ...b,
              answer: previous
                ? {
                    text: `${previous.text}\n\n---\n\n${text}`,
                    ok: previous.ok && ok,
                    costUsd: (previous.costUsd ?? 0) + (costUsd ?? 0),
                    durationMs,
                  }
                : { text, ok, costUsd, durationMs },
            }
          }
          return folded.has(b.askId) ? { ...b, redirected: true } : b
        })
      )
      break
    }
    case "asked": {
      // Activity so far belongs to the request that is now steering.
      if (!event.steering) break
      updateBlocks((blocks) => {
        const working = blocks.filter(
          (b): b is PromptBlock =>
            b.kind === "prompt" &&
            b.target === event.kind &&
            !!b.askId &&
            !b.answer &&
            !b.redirected
        )
        const earlier = working.filter((b) => b.askId !== event.askId)
        return blocks.map((b) =>
          b.kind === "prompt" && earlier.includes(b)
            ? { ...b, redirected: true }
            : b
        )
      })
      break
    }
    case "sync":
      set({ syncError: event.ok ? null : (event.error ?? "Sync failed") })
      break
    case "session":
      if (event.kind === "ingest") {
        set({ ingest: { ...state.ingest, resumeCommand: event.resumeCommand } })
      }
      break
    case "ended":
      set({
        savedPath: event.transcriptPath,
        ingest: { ...state.ingest, dir: event.ingestDir },
      })
      // Ended by the server (e.g. left unattended): stop recording too.
      if (state.phase === "live") void stopRecording()
      break
    default: {
      const unhandled: never = event
      void unhandled
    }
  }
}

function listen(id: string) {
  events?.close()
  events = new EventSource(`/api/meeting-events?id=${encodeURIComponent(id)}`)
  events.addEventListener("meeting", (message) => {
    onEvent(JSON.parse((message as MessageEvent<string>).data) as MeetingEvent)
  })
}

/* ── Public actions ── */

export async function startMeeting(options: {
  title: string
  folder: string
  languages: Array<string>
  deviceId?: string
}) {
  if (state.phase === "starting" || state.phase === "live") return
  nextSeq = 1
  segmentUploads = Promise.resolve()
  set({ ...initialState, phase: "starting" })
  try {
    const info = await startMeetingFn({
      data: { title: options.title, folder: options.folder },
    })
    set({ info })
    listen(info.id)
    capture = await startCapture(
      {
        deviceId: options.deviceId,
        languages: options.languages,
        getToken: async () => (await getSttToken()).token,
      },
      {
        onPartial: (partial) => {
          set({ partial })
          // Still talking: don't send a request mid-sentence.
          if (partial && listeningPrompt()) armSettle()
        },
        onCommitted,
        onStatus: (status, message) => set({ stt: { status, message } }),
        onLevel: setLevel,
      }
    )
    set({ phase: "live", startedAt: Date.now() })
  } catch (error) {
    events?.close()
    events = null
    const failed = state.info
    if (failed) void endMeetingFn({ data: { id: failed.id } }).catch(() => {})
    set({ phase: "idle", info: null, error: describeStartError(error) })
  }
}

function describeStartError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError") {
    return "Microphone access was denied. Allow Sshelf in System Settings › Privacy & Security › Microphone, then try again."
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "That microphone isn’t available. Pick another one."
  }
  return (error as Error).message
}

/** A typed request: goes to Claude right away, like a spoken one. After the
 * meeting it replies in the ingest conversation. */
export function askTyped(request: string) {
  const text = request.trim()
  if (!text || !state.info) return
  if (state.phase === "ended" && state.ingest.started) {
    const id = blockId()
    updateBlocks((blocks) => [...blocks, typedBlock(id, "ingest", [], text)])
    void sendPrompt(id)
    return
  }
  if (state.phase !== "live") return
  const segment: MeetingSegment = {
    seq: nextSeq++,
    at: new Date().toISOString(),
    text: `${TYPED_PREFIX}${text}`,
  }
  uploadSegment(segment)
  const capturing = listeningPrompt()
  if (capturing) void sendPrompt(capturing.id)
  const id = blockId()
  updateBlocks((blocks) => [
    ...blocks,
    typedBlock(id, "meeting", [segment], text),
  ])
  void sendPrompt(id)
}

function typedBlock(
  id: string,
  target: SessionKind,
  segments: Array<MeetingSegment>,
  request: string
): PromptBlock {
  return {
    kind: "prompt",
    id,
    target,
    segments,
    request,
    typed: true,
    state: "listening",
    steering: false,
    redirected: false,
    activity: [],
  }
}

/** Hand the finished meeting to Claude Code in the workspace folder that
 * holds its skills (e.g. Process/). */
export function ingestMeeting() {
  if (state.phase !== "ended" || !state.info || state.ingest.started) return
  const id = blockId()
  const where = state.ingest.dir || "the workspace"
  set({ ingest: { ...state.ingest, started: true } })
  updateBlocks((blocks) => [
    ...blocks,
    {
      ...typedBlock(id, "ingest", [], `Ingest this meeting into ${where}`),
      typed: false,
    },
  ])
  void sendPrompt(id)
}

/** Send the request being dictated now instead of waiting for silence. */
export function sendNow() {
  const capturing = listeningPrompt()
  if (capturing) void sendPrompt(capturing.id)
}

export async function stopClaude() {
  if (!state.info) return
  const kind: SessionKind = state.phase === "ended" ? "ingest" : "meeting"
  await stopClaudeFn({ data: { id: state.info.id, kind } })
}

export function setMuted(muted: boolean) {
  capture?.setMuted(muted)
  setLevel(0)
  set({ muted })
}

export async function endMeeting() {
  if (state.phase !== "live" || !state.info) return
  const id = state.info.id
  set({ phase: "ending" })
  sendNow()
  await capture?.stop()
  capture = null
  // The last words, flushed by stop(), must land before the server ends it.
  await segmentUploads
  try {
    await endMeetingFn({ data: { id } })
  } catch (error) {
    set({ error: (error as Error).message })
  }
  finishRecording()
}

async function stopRecording() {
  set({ phase: "ending" })
  await capture?.stop()
  capture = null
  finishRecording()
}

function finishRecording() {
  setLevel(0)
  set({ phase: "ended", partial: "", stt: { status: "off" } })
}

export function resetMeeting() {
  if (state.phase !== "ended" && state.phase !== "idle") return
  events?.close()
  events = null
  set(initialState)
}

function subscribeState(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMeeting(): MeetingState {
  return React.useSyncExternalStore(
    subscribeState,
    () => state,
    () => initialState
  )
}

/** Re-renders only when the selected value changes. */
export function useMeetingSelector<T>(select: (s: MeetingState) => T): T {
  return React.useSyncExternalStore(
    subscribeState,
    () => select(state),
    () => select(initialState)
  )
}

export function useMicLevel(): number {
  return React.useSyncExternalStore(
    (listener) => {
      levelListeners.add(listener)
      return () => levelListeners.delete(listener)
    },
    () => level,
    () => 0
  )
}
