import { randomUUID } from "node:crypto"
import { query } from "@anthropic-ai/claude-agent-sdk"
import {
  INGEST_SESSION_PROMPT,
  REMOTE_EXECUTABLE_PLACEHOLDER,
  findRemoteClaude,
  ingestRequest,
  meetingSessionPrompt,
  spawnOnServer,
} from "@/meeting/claude"
import { notifyRemoteFilesChanged } from "@/server/file-events"
import {
  REMOTE_ROOT,
  getCurrentHost,
  resolveRemotePath,
  runRemote,
  shellQuote,
  writeRemoteFileInBackground,
} from "@/server/ssh"
import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type {
  MeetingEvent,
  MeetingEventBody,
  MeetingSegment,
  SessionKind,
} from "@/lib/meeting-types"

/* In-memory meetings for the Sshelf meeting page. Each meeting owns its
   transcript (mirrored to the workspace) and up to two Claude Code sessions
   running on the server: the in-meeting assistant, started by the first
   request, and the session that ingests the transcript once the meeting is
   over. Messages that arrive while a session is working are queued into the
   same turn, which is how the user steers it. */

const MAX_EVENTS = 500
// A live meeting with no page attached this long (window closed, app quit)
// is ended so its Claude Code process on the server doesn't linger.
const ABANDON_AFTER_MS = 2 * 60_000
// An ended meeting is dropped once idle and unwatched for this long.
const FORGET_AFTER_MS = 10 * 60_000
// Transcript writes are batched: each one re-uploads the whole file.
const SYNC_DELAY_MS = 8_000

interface ClaudeSession {
  query: Query
  push: (message: SDKUserMessage) => void
  close: () => void
  /** Requests sent but not answered yet, oldest first. */
  pending: Array<string>
  /** The requests the previous answer covered, for a late extra answer. */
  lastAnswered: Array<string>
  /** Close once the requests in flight are answered. */
  closeWhenIdle: boolean
  stderr: string
}

interface Meeting {
  id: string
  title: string
  transcriptPath: string
  startedAt: string
  endedAt: string | null
  segments: Array<MeetingSegment>
  /** Segments already shown to the meeting assistant. */
  sentSeqs: Set<number>
  sessions: Record<SessionKind, ClaudeSession | null>
  /** Kept so a dropped SSH connection resumes with the session's history. */
  sessionIds: Record<SessionKind, string | null>
  /** The SDK reports cost cumulatively, including turns from before a
   * resume; answers show their own share. */
  costSoFar: Record<SessionKind, number>
  /** Workspace-relative folder the ingest session runs in. */
  ingestDir: string | null
  events: Array<MeetingEvent>
  nextEventSeq: number
  lastActivity: number
  listeners: Set<(event: MeetingEvent) => void>
  syncTimer?: ReturnType<typeof setTimeout>
  syncing: Promise<void> | null
  syncAgain: boolean
  syncError: string | null
  ended: boolean
  abandonTimer?: ReturnType<typeof setTimeout>
}

const meetings = new Map<string, Meeting>()

function emit(meeting: Meeting, event: MeetingEventBody) {
  const full: MeetingEvent = { ...event, seq: meeting.nextEventSeq++ }
  meeting.lastActivity = Date.now()
  meeting.events.push(full)
  if (meeting.events.length > MAX_EVENTS) meeting.events.shift()
  for (const listener of meeting.listeners) listener(full)
}

/** Status-only events go to open pages but aren't kept for replay, so they
 * can't push answers out of the replay buffer. */
function emitLive(meeting: Meeting, event: MeetingEventBody) {
  const full: MeetingEvent = { ...event, seq: 0 }
  for (const listener of meeting.listeners) listener(full)
}

export function getMeeting(id: string): Meeting {
  const meeting = meetings.get(id)
  if (!meeting) {
    throw new Error(
      "This meeting is no longer open in Sshelf (it was restarted, or the meeting sat idle)."
    )
  }
  return meeting
}

/** Meetings still recording or with Claude at work; the SSH host must not
 * change under them. */
export function hasActiveMeetings(): boolean {
  // An ingest conversation can be resumed until the meeting is forgotten.
  return [...meetings.values()].some(
    (m) =>
      !m.ended || m.sessionIds.ingest !== null || m.sessions.ingest !== null
  )
}

function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export function startMeeting(title: string, folder: string): Meeting {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const cleanTitle = title.trim() || "Meeting"
  // Validates the folder: throws on paths escaping the workspace.
  const dir = resolveRemotePath(folder).slice(REMOTE_ROOT.length + 1)
  const name = [stamp, slugify(cleanTitle)].filter(Boolean).join("-")
  const meeting: Meeting = {
    id: randomUUID(),
    title: cleanTitle,
    transcriptPath: dir ? `${dir}/${name}.md` : `${name}.md`,
    startedAt: now.toISOString(),
    endedAt: null,
    segments: [],
    sentSeqs: new Set(),
    sessions: { meeting: null, ingest: null },
    sessionIds: { meeting: null, ingest: null },
    costSoFar: { meeting: 0, ingest: 0 },
    ingestDir: null,
    events: [],
    nextEventSeq: 1,
    lastActivity: Date.now(),
    listeners: new Set(),
    syncing: null,
    syncAgain: false,
    syncError: null,
    ended: false,
  }
  meetings.set(meeting.id, meeting)
  return meeting
}

/* ── Transcript ── */

const hhmmss = (iso: string) => new Date(iso).toTimeString().slice(0, 8)

function formatSegments(segments: Array<MeetingSegment>, separator = "\n") {
  return segments.map((s) => `[${hhmmss(s.at)}] ${s.text}`).join(separator)
}

export function addSegment(meeting: Meeting, segment: MeetingSegment) {
  if (meeting.ended) throw new Error("This meeting has ended")
  if (meeting.segments.some((s) => s.seq === segment.seq)) return
  meeting.segments.push(segment)
  meeting.segments.sort((a, b) => a.seq - b.seq)
  meeting.lastActivity = Date.now()
  meeting.syncTimer ??= setTimeout(() => {
    meeting.syncTimer = undefined
    void syncTranscript(meeting)
  }, SYNC_DELAY_MS)
}

/** Rewrite the transcript file in the workspace; coalesces overlapping calls. */
function syncTranscript(meeting: Meeting): Promise<void> {
  clearTimeout(meeting.syncTimer)
  meeting.syncTimer = undefined
  if (meeting.syncing) {
    meeting.syncAgain = true
    return meeting.syncing
  }
  meeting.syncing = (async () => {
    do {
      meeting.syncAgain = false
      const body =
        `# ${meeting.title}\n\n` +
        formatSegments(meeting.segments, "\n\n") +
        "\n"
      let error: string | null = null
      try {
        await writeRemoteFileInBackground(
          meeting.transcriptPath,
          Buffer.from(body)
        )
      } catch (err) {
        error = (err as Error).message
      }
      if (error !== meeting.syncError) {
        meeting.syncError = error
        emitLive(
          meeting,
          error
            ? { type: "sync", ok: false, error }
            : { type: "sync", ok: true }
        )
      }
      // `addSegment` can set `syncAgain` while the write above is in flight.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } while (meeting.syncAgain)
    meeting.syncing = null
  })()
  return meeting.syncing
}

/** The closest folder above the transcript with its own Claude Code setup
 * (CLAUDE.md, AGENTS.md or .claude/), so its skills load; else the root. */
async function findIngestDir(transcriptPath: string): Promise<string> {
  const parts = transcriptPath.split("/").slice(0, -1)
  const candidates = parts.map((_, i) =>
    parts.slice(0, parts.length - i).join("/")
  )
  if (candidates.length === 0) return ""
  // The server answers with an index, never a path: `echo` can mangle names.
  const tests = candidates
    .map((dir, i) => {
      const abs = shellQuote(`${REMOTE_ROOT}/${dir}`)
      return `if [ -e ${abs}/CLAUDE.md ] || [ -e ${abs}/AGENTS.md ] || [ -d ${abs}/.claude ]; then echo ${i}; exit 0; fi`
    })
    .join("; ")
  try {
    const index = Number((await runRemote(`${tests}; echo -1`)).trim())
    return candidates[index] ?? ""
  } catch {
    return ""
  }
}

/* ── Claude ── */

function describeTool(name: string, input: Record<string, unknown>): string {
  const str = (key: string) =>
    typeof input[key] === "string" ? input[key] : ""
  switch (name) {
    case "Bash":
      return str("description") || `Running ${str("command").slice(0, 80)}`
    case "Read":
      return `Reading ${str("file_path").replace(/^.*\//, "")}`
    case "Write":
      return `Writing ${str("file_path").replace(/^.*\//, "")}`
    case "Edit":
      return `Editing ${str("file_path").replace(/^.*\//, "")}`
    case "Grep":
      return `Searching for “${str("pattern")}”`
    case "Glob":
      return `Looking for ${str("pattern")}`
    case "WebSearch":
      return `Searching the web for “${str("query")}”`
    case "WebFetch":
      return `Reading ${str("url")}`
    case "Skill":
      return `Using the ${str("skill") || str("command") || "requested"} skill`
    case "Agent":
    case "Task":
      return str("description") || "Delegating to a subagent"
    case "ToolSearch":
      return "Looking up tools"
    default:
      return name.startsWith("mcp__")
        ? `Using ${name.split("__").slice(1).join(" › ")}`
        : `Using ${name}`
  }
}

function sessionDir(meeting: Meeting, kind: SessionKind) {
  return kind === "ingest" && meeting.ingestDir
    ? `${REMOTE_ROOT}/${meeting.ingestDir}`
    : REMOTE_ROOT
}

function startClaude(meeting: Meeting, kind: SessionKind): ClaudeSession {
  const queue: Array<SDKUserMessage> = []
  let wake: (() => void) | null = null
  let closed = false
  async function* input() {
    // Deliver everything already queued, even once closing.
    while (!closed || queue.length) {
      const next = queue.shift()
      if (next) yield next
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  }

  const session: ClaudeSession = {
    query: null as unknown as Query,
    push: (message) => {
      queue.push(message)
      wake?.()
    },
    close: () => {
      closed = true
      wake?.()
    },
    pending: [],
    lastAnswered: [],
    closeWhenIdle: false,
    stderr: "",
  }
  const cwd = sessionDir(meeting, kind)
  session.query = query({
    prompt: input(),
    options: {
      pathToClaudeCodeExecutable: REMOTE_EXECUTABLE_PLACEHOLDER,
      spawnClaudeCodeProcess: spawnOnServer(
        process.env.SSHELF_REMOTE_CLAUDE,
        (tail) => (session.stderr = tail),
        cwd
      ),
      resume: meeting.sessionIds[kind] ?? undefined,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          kind === "ingest"
            ? INGEST_SESSION_PROMPT
            : meetingSessionPrompt(meeting.transcriptPath),
      },
      // Nobody can approve prompts from the meeting page: every tool is allowed.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  })
  void consume(meeting, kind, session, cwd)
  return session
}

async function announceSession(
  meeting: Meeting,
  kind: SessionKind,
  sessionId: string,
  cwd: string
) {
  let bin = "claude"
  try {
    bin = await findRemoteClaude(process.env.SSHELF_REMOTE_CLAUDE)
  } catch {
    // fall back to whatever `claude` resolves to in the user's shell
  }
  // Quote only what needs it, so the command stays readable.
  const q = (value: string) =>
    /^[\w./-]+$/.test(value) ? value : shellQuote(value)
  const remote = `cd ${q(cwd)} && ${q(bin)} --resume ${sessionId}`
  emit(meeting, {
    type: "session",
    kind,
    sessionId,
    cwd,
    resumeCommand: `ssh -t ${getCurrentHost() ?? "<host>"} ${shellQuote(remote)}`,
  })
}

/** Which pending requests a result answers: all of them (steering folds
 * into the running turn) except those the server's Claude still has queued
 * for a later turn. */
function takeAnswered(session: ClaudeSession, queued = 0) {
  if (session.pending.length === 0) return []
  const keep = Math.min(Math.max(queued, 0), session.pending.length - 1)
  return session.pending.splice(0, session.pending.length - keep)
}

async function consume(
  meeting: Meeting,
  kind: SessionKind,
  session: ClaudeSession,
  cwd: string
) {
  try {
    for await (const msg of session.query) {
      if (msg.type === "system" && msg.subtype === "init") {
        if (meeting.sessionIds[kind] !== msg.session_id) {
          meeting.sessionIds[kind] = msg.session_id
          // The page only offers the terminal hand-off for the ingest session.
          if (kind === "ingest") {
            void announceSession(meeting, kind, msg.session_id, cwd)
          }
        }
      } else if (msg.type === "assistant" && !msg.parent_tool_use_id) {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            emit(meeting, {
              type: "activity",
              askIds: [...session.pending],
              text: describeTool(
                block.name,
                block.input as Record<string, unknown>
              ),
            })
          }
        }
      } else if (msg.type === "result") {
        // Crash results may report zero: never show a negative share.
        const total = msg.total_cost_usd
        const costUsd = Math.max(0, total - meeting.costSoFar[kind])
        if (total >= meeting.costSoFar[kind]) meeting.costSoFar[kind] = total
        // A result with nothing pending answers a request that was folded
        // into the previous answer; attach it there rather than drop it.
        const answered = takeAnswered(session, msg.queued_turn_count)
        const askIds = answered.length ? answered : session.lastAnswered
        if (askIds.length === 0) continue
        session.lastAnswered = askIds
        emit(meeting, {
          type: "answer",
          askIds,
          ok: msg.subtype === "success" && !msg.is_error,
          text:
            msg.subtype === "success"
              ? msg.result.trim()
              : msg.subtype === "error_during_execution"
                ? "Stopped."
                : `Claude stopped: ${msg.subtype}`,
          costUsd,
          durationMs: msg.duration_ms,
        })
        // Claude may have changed files: refresh open pages now.
        notifyRemoteFilesChanged()
        if (session.closeWhenIdle && session.pending.length === 0) {
          session.close()
        }
      }
    }
  } catch (error) {
    const detail = session.stderr.trim().split("\n").slice(-2).join(" ")
    if (session.pending.length) {
      emit(meeting, {
        type: "answer",
        askIds: session.pending.splice(0),
        ok: false,
        text: `Claude failed: ${(error as Error).message}${detail ? ` (${detail})` : ""}`,
      })
    }
  } finally {
    if (session.pending.length) {
      emit(meeting, {
        type: "answer",
        askIds: session.pending.splice(0),
        ok: false,
        text: "Claude Code exited before answering.",
      })
    }
    if (meeting.sessions[kind] === session) meeting.sessions[kind] = null
  }
}

function send(
  meeting: Meeting,
  kind: SessionKind,
  text: string
): { askId: string; steering: boolean } {
  const session = (meeting.sessions[kind] ??= startClaude(meeting, kind))
  const steering = session.pending.length > 0
  const askId = randomUUID()
  session.pending.push(askId)
  session.push({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    // While Claude works, deliver at its next step instead of cancelling.
    priority: steering ? "next" : undefined,
  })
  emit(meeting, { type: "asked", kind, askId, steering })
  return { askId, steering }
}

/** Send the transcript Claude hasn't seen yet (up to `upToSeq`) plus
 * `request` to the in-meeting assistant. */
export function ask(meeting: Meeting, request: string, upToSeq: number) {
  if (meeting.ended) throw new Error("This meeting has ended")
  // Tracked per segment: one that arrives after a later request still gets
  // sent with the next one.
  const fresh = meeting.segments.filter(
    (s) => s.seq <= upToSeq && !meeting.sentSeqs.has(s.seq)
  )
  for (const s of fresh) meeting.sentSeqs.add(s.seq)
  const transcriptTag = meeting.sessionIds.meeting
    ? "transcript_since_last_message"
    : "meeting_transcript"
  const text =
    (fresh.length
      ? `<${transcriptTag}>\n${formatSegments(fresh)}\n</${transcriptTag}>\n\n`
      : "") +
    `<request>\n${request.trim() || "(no explicit request; infer what is most useful from the conversation)"}\n</request>`
  return send(meeting, "meeting", text)
}

/** Start ingesting the finished meeting, or reply in that conversation. */
export function ingest(meeting: Meeting, reply?: string) {
  if (!meeting.ended) throw new Error("End the meeting before ingesting it")
  if (reply !== undefined) return send(meeting, "ingest", reply)
  if (meeting.sessionIds.ingest || meeting.sessions.ingest) {
    throw new Error("This meeting is already being ingested")
  }
  // Paths in the request are relative to the folder Claude runs in.
  const prefix = meeting.ingestDir ? `${meeting.ingestDir}/` : ""
  return send(
    meeting,
    "ingest",
    ingestRequest({
      transcriptPath: meeting.transcriptPath.startsWith(prefix)
        ? meeting.transcriptPath.slice(prefix.length)
        : `${REMOTE_ROOT}/${meeting.transcriptPath}`,
      title: meeting.title,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt ?? new Date().toISOString(),
    })
  )
}

export async function stopClaude(meeting: Meeting, kind: SessionKind) {
  await meeting.sessions[kind]?.query.interrupt()
}

export async function endMeeting(meeting: Meeting) {
  if (meeting.ended) return
  meeting.ended = true
  meeting.endedAt = new Date().toISOString()
  clearTimeout(meeting.abandonTimer)
  // Let the assistant finish what it was asked before closing it.
  const assistant = meeting.sessions.meeting
  if (assistant?.pending.length) assistant.closeWhenIdle = true
  else assistant?.close()
  const [, ingestDir] = await Promise.all([
    syncTranscript(meeting),
    findIngestDir(meeting.transcriptPath),
  ])
  meeting.ingestDir = ingestDir
  emit(meeting, {
    type: "ended",
    transcriptPath: meeting.transcriptPath,
    ingestDir,
  })
  forgetWhenIdle(meeting)
}

/** Drop an ended meeting once nothing is running and nobody is watching. */
function forgetWhenIdle(meeting: Meeting) {
  const timer = setInterval(() => {
    const busy = Object.values(meeting.sessions).some(
      (s) => s && s.pending.length > 0
    )
    const idleFor = Date.now() - meeting.lastActivity
    if (busy || meeting.listeners.size > 0 || idleFor < FORGET_AFTER_MS) {
      return
    }
    clearInterval(timer)
    for (const session of Object.values(meeting.sessions)) session?.close()
    meetings.delete(meeting.id)
  }, 60_000)
}

/** Subscribe to a meeting's events, replaying those after `afterSeq`. */
export function subscribe(
  meeting: Meeting,
  afterSeq: number,
  listener: (event: MeetingEvent) => void
): () => void {
  for (const event of meeting.events) {
    if (event.seq > afterSeq) listener(event)
  }
  if (meeting.syncError) {
    listener({ type: "sync", ok: false, error: meeting.syncError, seq: 0 })
  }
  meeting.listeners.add(listener)
  clearTimeout(meeting.abandonTimer)
  let unsubscribed = false
  return () => {
    // Runtimes may report the same disconnect twice (abort and cancel).
    if (unsubscribed) return
    unsubscribed = true
    meeting.listeners.delete(listener)
    if (meeting.listeners.size === 0 && !meeting.ended) {
      clearTimeout(meeting.abandonTimer)
      meeting.abandonTimer = setTimeout(
        () => void endMeeting(meeting),
        ABANDON_AFTER_MS
      )
    }
  }
}
