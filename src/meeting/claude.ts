import { spawn } from "node:child_process"
import { DEFAULT_TRIGGERS } from "@/meeting/trigger"
import { TYPED_PREFIX } from "@/lib/meeting-types"
import {
  REMOTE_ROOT,
  SSH_BASE_ARGS,
  getCurrentHost,
  requireHost,
  runRemote,
  shellQuote,
} from "@/server/ssh"
import type {
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk"

/* Claude Code runs on the Sshelf server itself, over SSH, using whatever
   Claude Code install and login already exist there for the SSH user. The
   Agent SDK on this machine drives it through the process's stdio. */

/** Passed as the SDK's `pathToClaudeCodeExecutable` so it doesn't look for a
 * local native binary it would never run; `spawnOnServer` ignores it. */
export const REMOTE_EXECUTABLE_PLACEHOLDER = "claude"

// First executable found wins: PATH, the official installer, a Bun global
// install, then the newest CLI the Claude desktop app keeps for SSH sessions.
const FIND_CLAUDE = [
  `for c in "$(command -v claude 2>/dev/null)" "$HOME/.local/bin/claude" "$HOME/.bun/bin/claude"`,
  `"$(ls -1d "$HOME"/.claude/remote/ccd-cli/* 2>/dev/null | sort -V | tail -n 1)";`,
  `do [ -n "$c" ] && [ -f "$c" ] && [ -x "$c" ] && { CLAUDE_BIN="$c"; break; }; done;`,
  `[ -n "$CLAUDE_BIN" ] || { echo "Claude Code is not installed on this server" >&2; exit 127; };`,
].join(" ")

const remoteClaudeByHost = new Map<string, Promise<string>>()

/** Absolute path of the Claude Code executable on the server (cached per host). */
export function findRemoteClaude(remoteClaude?: string): Promise<string> {
  if (remoteClaude) return Promise.resolve(remoteClaude)
  const host = getCurrentHost() ?? ""
  let found = remoteClaudeByHost.get(host)
  if (!found) {
    found = runRemote(`${FIND_CLAUDE} echo "$CLAUDE_BIN"`).then((out) =>
      out.trim()
    )
    found.catch(() => remoteClaudeByHost.delete(host))
    remoteClaudeByHost.set(host, found)
  }
  return found
}

/** An Agent SDK `spawnClaudeCodeProcess` that runs Claude Code on the server
 * in `cwd` (absolute; default the workspace root). `onStderr` receives the
 * tail of the process's stderr. */
export function spawnOnServer(
  remoteClaude: string | undefined,
  onStderr: (tail: string) => void,
  cwd: string = REMOTE_ROOT
) {
  return (options: SpawnOptions): SpawnedProcess => {
    // Only forward what the SDK added on top of our own environment; the
    // server keeps its own PATH, HOME and Claude configuration.
    const env = Object.entries(options.env)
      .filter(
        ([key, value]) => value !== undefined && process.env[key] !== value
      )
      .map(([key, value]) => `${key}=${shellQuote(value!)}`)
    // A JS entry point is launched as `node cli.js …`; the server brings its own executable.
    const args = /(^|\/)(node|bun)$/.test(options.command)
      ? options.args.slice(1)
      : options.args
    const findBin = remoteClaude
      ? `CLAUDE_BIN=${shellQuote(remoteClaude)};`
      : FIND_CLAUDE
    const remoteCommand = [
      `cd ${shellQuote(cwd)} || exit 1;`,
      findBin,
      `exec env ${env.join(" ")} "$CLAUDE_BIN"`,
      ...args.map(shellQuote),
    ].join(" ")

    const child = spawn(
      "ssh",
      [...SSH_BASE_ARGS, "-T", requireHost(), remoteCommand],
      { stdio: ["pipe", "pipe", "pipe"], signal: options.signal }
    )
    let stderr = ""
    onStderr("")
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000)
      onStderr(stderr)
    })
    return child
  }
}

export const MEETING_CONTEXT = (transcriptPath: string) => `
You are being invoked by voice in the middle of a live meeting. User messages contain the
meeting transcript (machine-generated speech-to-text, so expect mis-heard words) and the
request that was spoken after the trigger phrase.

You are running on the user's Sshelf server; your working directory ${REMOTE_ROOT} is their
workspace. The live transcript of this meeting is saved at ${transcriptPath} in it.`

/** System prompt for the long-lived session behind the Sshelf meeting page. */
export function meetingSessionPrompt(transcriptPath: string) {
  return `${MEETING_CONTEXT(transcriptPath)}

Each new message brings the transcript since your previous answer, then a request. A message
that arrives while you are still working is the user steering you: take it into account.
- Do the task, using tools if useful.
- Nobody can answer follow-up questions or approve actions; make reasonable assumptions.
- Your final message is shown in a compact answer card: keep it short (a few sentences or a
  short list). Markdown is fine. Mention any file you created or changed.`
}

/** System prompt addition for the session that ingests a finished meeting. */
export const INGEST_SESSION_PROMPT = `
You were started from the Sshelf meeting page, on the user's server, to ingest a meeting that
was just recorded. Your final message is shown in a compact card: keep it short (a few
sentences or a short list), Markdown is fine, and list the files you created or changed. The
user may reply later in the same conversation.`

export function ingestRequest(details: {
  transcriptPath: string
  title: string
  startedAt: string
  endedAt: string
}) {
  const start = new Date(details.startedAt)
  const end = new Date(details.endedAt)
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const triggers = DEFAULT_TRIGGERS.slice(0, 3)
    .map((t) => `"${t}"`)
    .join(", ")
  return `A meeting was just recorded and transcribed live in Sshelf. Ingest it into this workspace,
following this workspace's own instructions and skills for incoming transcripts.

- Raw transcript: ${details.transcriptPath}
- Title: ${details.title}
- Date: ${date}, ${clock(start)}–${clock(end)}

About the transcript: it is machine speech-to-text, one "[hh:mm:ss] text" line per utterance,
with no speaker labels, and mis-heard words are likely. A line containing a trigger phrase such
as ${triggers} (or a similar mis-hearing), and the line or two right after it, were requests to
an AI assistant during the meeting. Lines starting with "${TYPED_PREFIX.trim()}" were typed to it.

Nobody is watching to approve actions right now, so make reasonable choices instead of
stopping to ask, and note anything you would like confirmed. Leave the raw transcript file
where it is unless this workspace's instructions say otherwise.`
}
