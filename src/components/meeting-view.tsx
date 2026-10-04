import * as React from "react"
import { Link } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircleIcon,
  ChevronRightIcon,
  CheckIcon,
  CircleStopIcon,
  CopyIcon,
  ExternalLinkIcon,
  CornerDownRightIcon,
  FileTextIcon,
  InboxIcon,
  MicIcon,
  MicOffIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { listMicrophones } from "@/lib/meeting-audio"
import {
  askTyped,
  endMeeting,
  ingestMeeting,
  resetMeeting,
  sendNow,
  setMuted,
  startMeeting,
  stopClaude,
  useMeeting,
  useMicLevel,
} from "@/lib/meeting-store"
import { cn } from "@/lib/utils"
import { DEFAULT_TRIGGER_RE } from "@/meeting/trigger"
import {
  getMeetingSetup,
  removeElevenLabsKey,
  saveElevenLabsKey,
} from "@/server/meeting"
import type {
  MeetingState,
  PromptBlock,
  TranscriptBlock,
} from "@/lib/meeting-store"
import type { MeetingSegment } from "@/lib/meeting-types"

const REMARK_PLUGINS = [remarkGfm]

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(`sshelf.meeting.${key}`) ?? fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(`sshelf.meeting.${key}`, value)
  } catch {
    // preferences are a convenience only
  }
}

export function MeetingView() {
  const meeting = useMeeting()
  return (
    <div className="flex min-h-svh min-w-0 flex-1 flex-col">
      <MeetingHeader meeting={meeting} />
      {meeting.phase === "idle" || meeting.phase === "starting" ? (
        <SetupPanel meeting={meeting} />
      ) : (
        <Timeline meeting={meeting} />
      )}
    </div>
  )
}

/* ── Header ── */

function useSecondsSince(since: number) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor((now - since) / 1000))
}

function WorkingFor({ since }: { since: number }) {
  const seconds = useSecondsSince(since)
  return seconds >= 3 ? (
    <span className="text-xs text-muted-foreground tabular-nums">
      {seconds} s
    </span>
  ) : null
}

function Elapsed({ since }: { since: number }) {
  const seconds = useSecondsSince(since)
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")
  return <span className="font-mono tabular-nums">{`${mm}:${ss}`}</span>
}

function LevelMeter({ muted }: { muted: boolean }) {
  const level = useMicLevel()
  const bars = [0.2, 0.45, 0.7, 1]
  const scaled = Math.min(1, level * 8)
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {bars.map((threshold, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full transition-colors",
            !muted && scaled >= threshold * 0.6
              ? "bg-[var(--orange-500)]"
              : "bg-[var(--navy-200)]"
          )}
          style={{ height: `${30 + threshold * 70}%` }}
        />
      ))}
    </span>
  )
}

function MeetingHeader({ meeting }: { meeting: MeetingState }) {
  const live = meeting.phase === "live"
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 bg-background/85 px-5 py-3 backdrop-blur-md">
      <SidebarTrigger />
      <h1 className="flex min-w-0 items-center gap-2 text-base font-semibold text-[var(--navy-700)]">
        <MicIcon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{meeting.info?.title ?? "Meeting"}</span>
      </h1>
      {live && meeting.startedAt && (
        <span className="flex items-center gap-2 rounded-full bg-[var(--navy-50)] px-2.5 py-1 text-xs text-[var(--navy-600)]">
          <span
            className={cn(
              "size-2 rounded-full",
              meeting.muted
                ? "bg-[var(--navy-300)]"
                : "animate-pulse bg-red-500"
            )}
          />
          <Elapsed since={meeting.startedAt} />
          <LevelMeter muted={meeting.muted} />
        </span>
      )}
      {live && meeting.stt.status !== "live" && (
        <Badge variant="secondary">
          {meeting.stt.status === "error"
            ? "Transcription stopped"
            : "Connecting…"}
        </Badge>
      )}
      <div className="flex-1" />
      {live && (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMuted(!meeting.muted)}
          >
            {meeting.muted ? (
              <MicOffIcon data-icon="inline-start" />
            ) : (
              <MicIcon data-icon="inline-start" />
            )}
            {meeting.muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void endMeeting()}
          >
            <SquareIcon data-icon="inline-start" />
            End meeting
          </Button>
        </>
      )}
      {meeting.phase === "ending" && (
        <Badge variant="secondary">
          <Spinner className="size-3" /> Saving…
        </Badge>
      )}
      {meeting.phase === "ended" && (
        <Button variant="secondary" size="sm" onClick={resetMeeting}>
          New meeting
        </Button>
      )}
    </header>
  )
}

/* ── Setup ── */

function SetupPanel({ meeting }: { meeting: MeetingState }) {
  const setup = useQuery({
    queryKey: ["meeting-setup"],
    queryFn: () => getMeetingSetup(),
  })
  const [title, setTitle] = React.useState("")
  const [languages, setLanguages] = React.useState(() =>
    readPref("languages", "en")
  )
  const [deviceId, setDeviceId] = React.useState(() => readPref("device", ""))
  const [folder, setFolder] = React.useState(() =>
    readPref("folder", "Process/inbox")
  )
  const [mics, setMics] = React.useState<Array<MediaDeviceInfo>>([])

  React.useEffect(() => {
    listMicrophones()
      .then(setMics)
      .catch(() => setMics([]))
  }, [])

  function start(event: React.FormEvent) {
    event.preventDefault()
    writePref("languages", languages)
    writePref("device", deviceId)
    writePref("folder", folder)
    void startMeeting({
      title,
      folder,
      deviceId: deviceId || undefined,
      languages: languages
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    })
  }

  const starting = meeting.phase === "starting"
  return (
    <div className="mx-auto w-full max-w-xl px-5 py-10">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--navy-700)]">
          Start a meeting
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The conversation is transcribed live and saved to your workspace. Say{" "}
          <strong className="text-foreground">“Hey Claude”</strong> followed by
          a request and Claude Code
          {setup.data?.host ? ` on ${setup.data.host}` : ""} works on it with
          the meeting so far as context.
        </p>
      </div>

      {meeting.error && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircleIcon />
          <AlertTitle>Could not start the meeting</AlertTitle>
          <AlertDescription>{meeting.error}</AlertDescription>
        </Alert>
      )}

      {setup.data && !setup.data.apiKey ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="font-semibold text-[var(--navy-700)]">
            Connect ElevenLabs
          </h3>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Live transcription uses your own ElevenLabs account. Create an API
            key with the <strong>Speech to Text</strong> permission and paste it
            here.
          </p>
          <ApiKeyForm />
        </div>
      ) : (
        <form
          onSubmit={start}
          className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm"
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Title
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly sync"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Save transcripts to
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Process/inbox"
              className="font-mono text-[13px]"
            />
            <span className="text-xs font-normal text-muted-foreground">
              Workspace folder. After the meeting, Claude ingests it from the
              closest folder with its own CLAUDE.md or skills.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Languages
              <Input
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                placeholder="en or fr,en"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Main language first. Empty to auto-detect.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Microphone
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              >
                <option value="">System default</option>
                {mics
                  .filter((m) => m.deviceId && m.deviceId !== "default")
                  .map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label || "Microphone"}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <Button type="submit" size="lg" disabled={starting || !setup.data}>
            {starting ? <Spinner /> : <MicIcon data-icon="inline-start" />}
            {starting ? "Starting…" : "Start meeting"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Claude runs with every tool allowed, using the Claude Code login and
            settings already on the server. Requests are acted on without
            confirmation.
          </p>
        </form>
      )}
      {setup.data?.apiKey && <ApiKeyStatus apiKey={setup.data.apiKey} />}
    </div>
  )
}

function ApiKeyForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient()
  const [key, setKey] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await saveElevenLabsKey({ data: { key } })
      setKey("")
      await queryClient.invalidateQueries({ queryKey: ["meeting-setup"] })
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk_…"
          autoComplete="off"
          autoFocus={!!onDone}
        />
        <Button type="submit" disabled={!key.trim() || saving}>
          {saving && <Spinner />}
          {saving ? "Checking…" : "Save"}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <a
        href="https://elevenlabs.io/app/settings/api-keys"
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-[var(--navy-600)] underline underline-offset-2"
      >
        Create an API key on ElevenLabs
        <ExternalLinkIcon className="size-3.5" aria-hidden />
      </a>
      <p className="text-xs text-muted-foreground">
        Give it the Speech to Text permission. It is checked with ElevenLabs,
        then stored for your user on this computer only
        (~/.sshelf-meeting.json). It never reaches the server or the page.
      </p>
    </form>
  )
}

function ApiKeyStatus({ apiKey }: { apiKey: { last4: string } }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)

  async function remove() {
    await removeElevenLabsKey()
    await queryClient.invalidateQueries({ queryKey: ["meeting-setup"] })
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">ElevenLabs key</span>
        <span className="font-mono text-[13px] text-[var(--navy-600)]">
          ••••{apiKey.last4}
        </span>
        <div className="flex-1" />
        {!editing && (
          <>
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        )}
      </div>
      {editing && (
        <div className="mt-3">
          <ApiKeyForm onDone={() => setEditing(false)} />
        </div>
      )}
    </div>
  )
}

/* ── Timeline ── */

function Timeline({ meeting }: { meeting: MeetingState }) {
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)

  React.useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onScroll = () => {
      pinned.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
    }
    scroller.addEventListener("scroll", onScroll)
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [])

  React.useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ block: "end" })
  }, [meeting.blocks, meeting.partial])

  const last = meeting.blocks.at(-1)
  const live = meeting.phase === "live"
  // The live partial belongs to whatever is being spoken into right now.
  const showOpenTranscript =
    live && (!last || (last.kind === "prompt" && last.state !== "listening"))

  return (
    <>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 pt-4 pb-6">
          {meeting.syncError && (
            <Alert className="bg-card">
              <AlertCircleIcon />
              <AlertTitle>
                The transcript isn’t reaching the workspace
              </AlertTitle>
              <AlertDescription>{meeting.syncError}</AlertDescription>
            </Alert>
          )}
          {meeting.stt.status === "error" && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Transcription stopped</AlertTitle>
              <AlertDescription>{meeting.stt.message}</AlertDescription>
            </Alert>
          )}
          {meeting.blocks.map((block, i) =>
            block.kind === "prompt" &&
            block.target === "ingest" ? null : block.kind === "transcript" ? (
              <TranscriptSection
                key={block.id}
                block={block}
                active={live && i === meeting.blocks.length - 1}
                partial={meeting.partial}
              />
            ) : (
              <PromptSection
                key={block.id}
                block={block}
                partial={i === meeting.blocks.length - 1 ? meeting.partial : ""}
              />
            )
          )}
          {showOpenTranscript && (
            <TranscriptSection
              block={{ kind: "transcript", id: "open", segments: [] }}
              active
              partial={meeting.partial}
            />
          )}
          {meeting.phase === "ended" && <EndedNote meeting={meeting} />}
          {meeting.blocks.map((block) =>
            block.kind === "prompt" && block.target === "ingest" ? (
              <PromptSection key={block.id} block={block} partial="" />
            ) : null
          )}
          {meeting.ingest.resumeCommand && (
            <ResumeHint command={meeting.ingest.resumeCommand} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {(live || (meeting.phase === "ended" && meeting.ingest.started)) && (
        <Composer meeting={meeting} />
      )}
    </>
  )
}

function TranscriptSection({
  block,
  active,
  partial,
}: {
  block: TranscriptBlock
  active: boolean
  partial: string
}) {
  const [open, setOpen] = React.useState(false)
  const segments = block.segments
  const preview = active && partial ? partial : segments.at(-1)?.text
  const range =
    segments.length > 0
      ? segments.length > 1
        ? `${time(segments[0].at)}–${time(segments.at(-1)!.at)}`
        : time(segments[0].at)
      : null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-dashed border-[var(--navy-100)] bg-[var(--sand-50)]">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-[var(--navy-300)] transition-transform",
              open && "rotate-90"
            )}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-[var(--navy-400)] uppercase">
            Transcript
          </span>
          {segments.length > 0 && (
            <span className="shrink-0 text-xs text-[var(--navy-300)]">
              {segments.length} {segments.length === 1 ? "line" : "lines"}
              {range && ` · ${range}`}
            </span>
          )}
          {active && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--orange-600)]">
              <span className="size-1.5 animate-pulse rounded-full bg-[var(--orange-500)]" />
              listening
            </span>
          )}
          {!open && preview && (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                active && partial
                  ? "text-[var(--navy-400)] italic"
                  : "text-muted-foreground"
              )}
            >
              {preview}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="flex flex-col gap-1.5 border-t border-dashed border-[var(--navy-100)] px-3 py-2.5">
            {segments.map((s) => (
              <SegmentLine key={s.seq} segment={s} />
            ))}
            {active && partial && (
              <li className="flex gap-3 text-sm text-[var(--navy-400)] italic">
                <span className="w-11 shrink-0" />
                {partial}
              </li>
            )}
            {segments.length === 0 && !partial && (
              <li className="text-sm text-muted-foreground">
                Nothing said yet.
              </li>
            )}
          </ol>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function SegmentLine({ segment }: { segment: MeetingSegment }) {
  return (
    <li className="flex gap-3 text-sm leading-relaxed">
      <span className="w-11 shrink-0 pt-0.5 font-mono text-[11px] text-[var(--navy-300)]">
        {time(segment.at)}
      </span>
      <span className="text-[var(--navy-600)]">{segment.text}</span>
    </li>
  )
}

/** The request text with the spoken trigger phrase marked. */
function WithTrigger({ text }: { text: string }) {
  const match = DEFAULT_TRIGGER_RE.exec(text)
  if (!match) return <>{text}</>
  const end = match.index + match[0].trimEnd().length
  return (
    <>
      {text.slice(0, match.index)}
      <mark className="rounded bg-[var(--orange-300)]/60 px-0.5 text-inherit">
        {text.slice(match.index, end)}
      </mark>
      {text.slice(end)}
    </>
  )
}

function PromptSection({
  block,
  partial,
}: {
  block: PromptBlock
  partial: string
}) {
  const listening = block.state === "listening"
  const working = block.state === "sent" && !block.answer && !block.redirected
  const at = block.segments[0]?.at

  return (
    <section className="flex flex-col gap-2 py-1">
      <div className="rounded-xl border border-[var(--orange-300)] bg-[color-mix(in_oklch,var(--orange-300)_14%,white)] px-4 py-3 shadow-sm">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-[var(--orange-700)]">
          {block.target === "ingest" && !block.typed ? (
            <InboxIcon className="size-3.5" aria-hidden />
          ) : (
            <SparklesIcon className="size-3.5" aria-hidden />
          )}
          <span className="font-semibold">
            {block.target === "ingest"
              ? block.typed
                ? "Reply"
                : "Ingest"
              : block.typed
                ? "Typed request"
                : "Hey Claude"}
          </span>
          {at && (
            <span className="text-[var(--orange-600)]/80">{time(at)}</span>
          )}
          {block.steering && (
            <Badge
              variant="secondary"
              className="bg-white/70 text-[var(--orange-700)]"
            >
              steering
            </Badge>
          )}
          <div className="flex-1" />
          {listening && (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 text-[var(--orange-700)]"
              onClick={sendNow}
            >
              Send now
            </Button>
          )}
        </div>
        <p className="text-[15px] leading-relaxed text-[var(--navy-700)]">
          {block.typed || block.target === "ingest" ? (
            block.request
          ) : (
            <WithTrigger text={block.segments.map((s) => s.text).join(" ")} />
          )}
          {listening && partial && (
            <span className="text-[var(--navy-400)] italic"> {partial}</span>
          )}
        </p>
        {listening && (
          <p className="mt-1.5 text-xs text-[var(--orange-700)]/80">
            Listening — sends after a short pause.
          </p>
        )}
      </div>

      {(working || block.state === "sending") && (
        <div className="ml-4 flex flex-col gap-1 border-l-2 border-[var(--navy-100)] pl-4">
          <div className="flex items-center gap-2 text-sm text-[var(--navy-600)]">
            <Spinner className="size-3.5" />
            <span>{block.activity.at(-1) ?? "Claude is working…"}</span>
            {block.sentAt && <WorkingFor since={block.sentAt} />}
          </div>
          {block.activity.length > 1 && (
            <ul className="flex flex-col gap-0.5">
              {block.activity
                .slice(0, -1)
                .slice(-4)
                .map((line, i) => (
                  <li
                    key={i}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {line}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {block.redirected && !block.answer && (
        <p className="ml-4 flex items-center gap-1.5 border-l-2 border-[var(--navy-100)] pl-4 text-xs text-muted-foreground">
          <CornerDownRightIcon className="size-3.5" aria-hidden />
          Steered by the next request — answered below.
        </p>
      )}

      {block.state === "failed" && (
        <p className="ml-4 border-l-2 border-destructive/40 pl-4 text-sm text-destructive">
          {block.error}
        </p>
      )}

      {block.answer && <AnswerCard answer={block.answer} />}
    </section>
  )
}

function AnswerCard({
  answer,
}: {
  answer: NonNullable<PromptBlock["answer"]>
}) {
  const meta = [
    answer.durationMs !== undefined &&
      `${(answer.durationMs / 1000).toFixed(1)} s`,
    answer.costUsd !== undefined && `$${answer.costUsd.toFixed(3)}`,
  ].filter(Boolean)
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-4 py-3 shadow-sm",
        !answer.ok && "border-destructive/40"
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-[var(--navy-700)]">Claude</span>
        {meta.length > 0 && <span>{meta.join(" · ")}</span>}
      </div>
      <div className="prose prose-sm max-w-none prose-stone prose-p:my-1.5 prose-a:text-[var(--navy-600)] prose-code:rounded prose-code:bg-[var(--stone-100)] prose-code:px-1 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-ul:my-1.5">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
          {answer.text}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function EndedNote({ meeting }: { meeting: MeetingState }) {
  const path = meeting.savedPath ?? meeting.info?.transcriptPath
  const { dir, started } = meeting.ingest
  const where = dir ? `${dir}/` : "the workspace root"
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-[var(--navy-50)] px-4 py-3.5 text-sm text-[var(--navy-600)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <FileTextIcon className="size-4 shrink-0" aria-hidden />
        Meeting ended.
        {path && (
          <>
            {" Transcript saved to "}
            <Link
              to="/$"
              params={{ _splat: path }}
              className="font-mono text-[13px] font-medium underline underline-offset-2"
            >
              {path}
            </Link>
          </>
        )}
      </div>
      {!started && meeting.savedPath && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--navy-100)] pt-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            Claude Code opens in{" "}
            <span className="font-mono text-[var(--navy-600)]">{where}</span>{" "}
            with that folder’s instructions and skills, and files, summarizes
            and logs the meeting there.
          </p>
          <Button onClick={ingestMeeting}>
            <InboxIcon data-icon="inline-start" />
            Ingest with Claude
          </Button>
        </div>
      )}
    </div>
  )
}

function ResumeHint({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable; the command stays selectable
    }
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <span>Continue this conversation in a terminal:</span>
      <div className="flex items-center gap-2 rounded-lg bg-[var(--navy-800)] py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--navy-100)] select-all">
          {command}
        </code>
        <Button
          size="xs"
          variant="ghost"
          className="text-[var(--navy-100)] hover:bg-white/10 hover:text-white"
          onClick={() => void copy()}
          aria-label="Copy command"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  )
}

function Composer({ meeting }: { meeting: MeetingState }) {
  const [text, setText] = React.useState("")
  const target = meeting.phase === "ended" ? "ingest" : "meeting"
  const working = meeting.blocks.some(
    (b) =>
      b.kind === "prompt" &&
      b.target === target &&
      (b.state === "sending" ||
        (b.state === "sent" && !b.answer && !b.redirected))
  )
  function submit(event: React.FormEvent) {
    event.preventDefault()
    askTyped(text)
    setText("")
  }
  return (
    <div className="sticky bottom-0 border-t bg-background/90 backdrop-blur-md">
      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 py-3"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            target === "ingest"
              ? working
                ? "Steer Claude…"
                : "Reply to Claude…"
              : working
                ? "Steer Claude… (or say “Hey Claude”)"
                : "Ask Claude… (or say “Hey Claude”)"
          }
          className="bg-card"
        />
        <Button type="submit" disabled={!text.trim()}>
          <SendIcon data-icon="inline-start" />
          {working ? "Steer" : target === "ingest" ? "Reply" : "Ask"}
        </Button>
        {working && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void stopClaude()}
          >
            <CircleStopIcon data-icon="inline-start" />
            Stop
          </Button>
        )}
      </form>
    </div>
  )
}
