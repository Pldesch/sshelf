/* Meeting assistant: live-transcribes the mic with ElevenLabs into the Sshelf
   workspace, and hands the transcript to Claude Code when someone says
   "Hey Claude". Claude Code runs on the server over SSH, with the server's
   own install, login and config. */
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { parseArgs } from "node:util"
import { listDevices, startMic } from "@/meeting/audio"
import { askClaude } from "@/meeting/cli-claude"
import { ElevenLabsStt } from "@/meeting/stt"
import { Transcript, hhmmss } from "@/meeting/transcript"
import {
  DEFAULT_TRIGGERS,
  buildTriggerRegex,
  findTrigger,
} from "@/meeting/trigger"
import { readElevenLabsKey } from "@/server/elevenlabs-key"
import {
  REMOTE_ROOT,
  getCurrentHost,
  runRemote,
  setSshHost,
} from "@/server/ssh"
import type { ClaudeAnswer, ClaudeConfig } from "@/meeting/cli-claude"

const HELP = `sshelf meeting: live meeting transcription into your Sshelf workspace, with a "Hey Claude" trigger
that runs Claude Code on the server, with its existing login and config

Usage: bun run meeting [options]

  --host <alias>          SSH host (default: SSHELF_SSH_HOST or the host chosen in Sshelf)
  --dir <path>            Workspace folder for transcripts (default: meetings)
  --title <text>          Meeting title for the transcript header
  --device <name|index>   AVFoundation audio input (default: system default mic)
  --list-devices          List audio inputs and exit
  --language <codes>      Transcription language(s), e.g. fr or fr,en (first = main language).
                          Default: TRANSCRIBE_LANGUAGE, else auto-detect
  --trigger <phrases>     Comma-separated trigger phrases (default: "hey claude" + common mis-hearings)
  --remote-claude <path>  Claude Code executable on the server (default: auto-detect)
  --model <id>            Claude model (default: your Claude Code default)
  --max-turns <n>         Max agent turns per request (default: 20)

Workspace root: SSHELF_REMOTE_ROOT (default /home/ubuntu), same as the app.
The ElevenLabs API key is the one saved on the Meeting page in Sshelf.
Env: TRANSCRIBE_LANGUAGE, SSHELF_REMOTE_CLAUDE. Put them in .env.local.

While running: say the trigger, then your request. You can also type a request and press Enter.
Ctrl+C stops and saves.`

const { values: args } = parseArgs({
  options: {
    host: { type: "string" },
    dir: { type: "string", default: "meetings" },
    title: { type: "string" },
    device: { type: "string", default: "default" },
    "list-devices": { type: "boolean" },
    language: { type: "string", default: process.env.TRANSCRIBE_LANGUAGE },
    trigger: { type: "string" },
    "remote-claude": {
      type: "string",
      default: process.env.SSHELF_REMOTE_CLAUDE,
    },
    model: { type: "string" },
    "max-turns": { type: "string", default: "20" },
    help: { type: "boolean", short: "h" },
  },
})

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function fail(message: string): never {
  console.error(c.red(message))
  process.exit(1)
}

if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args["list-devices"]) {
  console.log(await listDevices())
  process.exit(0)
}

const apiKey = readElevenLabsKey()
if (!apiKey)
  fail("No ElevenLabs API key: add one on the Meeting page in Sshelf.")

if (args.host) setSshHost(args.host)
const host = getCurrentHost()
if (!host) {
  fail("No SSH host: pick one in Sshelf, or pass --host / SSHELF_SSH_HOST.")
}
try {
  await runRemote("true")
} catch (error) {
  fail(`Cannot reach ${host} over SSH: ${(error as Error).message}`)
}

const localDir = join(homedir(), ".sshelf-meetings")
const transcript = new Transcript(args.dir, localDir, args.title)
const claudeCfg: ClaudeConfig = {
  transcriptPath: transcript.remotePath,
  remoteClaude: args["remote-claude"],
  model: args.model,
  maxTurns: Number(args["max-turns"]),
}
const triggerRe = buildTriggerRegex(
  args.trigger ? args.trigger.split(",") : DEFAULT_TRIGGERS
)

/* ── Terminal output: the live partial transcript is drawn on the last
     line and overwritten in place. ── */

let partial = ""
const drawPartial = () =>
  process.stdout.write(`\r\x1b[K${partial ? c.dim("… " + partial) : ""}`)
const println = (line: string) => {
  process.stdout.write(`\r\x1b[K${line}\n`)
  drawPartial()
}

function wrap(value: string, width: number) {
  return value.split("\n").flatMap((para) => {
    const lines: Array<string> = []
    let cur = ""
    for (const word of para.split(/\s+/)) {
      if (cur && cur.length + word.length + 1 > width) {
        lines.push(cur)
        cur = word
      } else cur = cur ? `${cur} ${word}` : word
    }
    return [...lines, cur]
  })
}

function showAnswer(request: string, answer: ClaudeAnswer) {
  const width = Math.min(process.stdout.columns || 80, 100) - 4
  const meta = [
    answer.durationMs && `${(answer.durationMs / 1000).toFixed(1)}s`,
    answer.costUsd && `$${answer.costUsd.toFixed(3)}`,
  ]
    .filter(Boolean)
    .join(" · ")
  const color = answer.ok ? c.cyan : c.red
  println(color(`╭─ Claude ${c.dim(`re: ${request.slice(0, width - 20)}`)}`))
  for (const line of wrap(answer.text, width)) println(color("│ ") + line)
  println(color(`╰─ ${c.dim(meta)}`))
}

/* ── Triggering: a spoken request often spans several VAD segments
     ("Hey Claude, can you…" <pause> "…check X"), so after a trigger we keep
     collecting segments until the speaker has been quiet for a bit. ── */

const REQUEST_SETTLE_MS = 2500
const EMPTY_REQUEST_WAIT_MS = 10_000
let pendingRequest: { parts: Array<string>; timer?: NodeJS.Timeout } | null =
  null

function runClaude(request: string) {
  const context = transcript.format()
  println(
    c.yellow(
      `⚡ Claude is working on: ${request || "(infer from conversation)"}`
    )
  )
  void askClaude(context, request, claudeCfg).then((answer) =>
    showAnswer(request, answer)
  )
}

function armRequestTimer() {
  if (!pendingRequest) return
  clearTimeout(pendingRequest.timer)
  const wait = pendingRequest.parts.join(" ").trim()
    ? REQUEST_SETTLE_MS
    : EMPTY_REQUEST_WAIT_MS
  pendingRequest.timer = setTimeout(() => {
    const request = pendingRequest!.parts.join(" ").trim()
    pendingRequest = null
    runClaude(request)
  }, wait)
}

let lastSyncError: string | null = null
function onCommitted(text: string) {
  partial = ""
  const seg = transcript.add(text)
  const afterTrigger = findTrigger(text, triggerRe)
  println(
    `${c.dim(hhmmss(seg.at))} ${afterTrigger !== null ? c.bold(text) : text}`
  )
  if (transcript.lastSyncError !== lastSyncError) {
    lastSyncError = transcript.lastSyncError
    println(
      lastSyncError
        ? c.red(`· Workspace sync failing (${lastSyncError}); kept locally`)
        : c.dim("· Workspace sync recovered")
    )
  }

  if (afterTrigger !== null) {
    if (pendingRequest) clearTimeout(pendingRequest.timer)
    pendingRequest = { parts: [afterTrigger] }
    armRequestTimer()
  } else if (pendingRequest) {
    pendingRequest.parts.push(text)
    armRequestTimer()
  }
}

/* ── Wiring ── */

const stt = new ElevenLabsStt(
  apiKey,
  {
    onPartial: (text) => {
      partial = text
      drawPartial()
      // Speaker is still talking: don't fire a pending request mid-sentence.
      if (pendingRequest && text) armRequestTimer()
    },
    onCommitted,
    onStatus: (msg) => println(c.dim(`· ${msg}`)),
    onFatal: (msg) => {
      println(c.red(msg))
      void shutdown(1)
    },
  },
  (args.language ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean)
)
stt.connect()

let stopping = false
const mic = startMic(
  args.device,
  (pcm) => stt.send(pcm),
  (err) => {
    if (err && !stopping) {
      println(c.red(`Microphone error: ${err}`))
      void shutdown(1)
    }
  }
)

const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
  const request = line.trim()
  if (request) runClaude(request)
})

println(
  c.dim(
    `· Mic "${args.device}" · Language: ${args.language || "auto-detect"} · Claude runs on ${host} with all tools`
  )
)
println(c.dim(`· Transcript: ${host}:${REMOTE_ROOT}/${transcript.remotePath}`))
println(
  c.dim(`· Say "Hey Claude, …" or type a request + Enter. Ctrl+C to stop.`)
)

async function shutdown(code = 0) {
  if (stopping) process.exit(code)
  stopping = true
  mic.kill("SIGINT")
  println(c.dim("· Stopping, flushing last segment…"))
  await stt.close()
  rl.close()
  if (transcript.segments.length === 0) {
    println(c.dim("· Nothing was transcribed; no transcript saved."))
    process.exit(code)
  }
  await transcript.sync()
  println(
    transcript.lastSyncError
      ? c.red(
          `Could not save to the workspace (${transcript.lastSyncError}). Local copy: ${transcript.localPath}`
        )
      : `Saved transcript (${transcript.segments.length} segments): ${host}:${REMOTE_ROOT}/${transcript.remotePath}`
  )
  process.exit(code)
}
process.on("SIGINT", () => void shutdown(0))
