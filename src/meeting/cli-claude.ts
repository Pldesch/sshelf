import { query } from "@anthropic-ai/claude-agent-sdk"
import {
  MEETING_CONTEXT,
  REMOTE_EXECUTABLE_PLACEHOLDER,
  spawnOnServer,
} from "@/meeting/claude"

/* One-shot Claude requests for the `bun run meeting` CLI. */

export interface ClaudeConfig {
  /** Workspace-relative path of the live transcript. */
  transcriptPath: string
  /** Path of the claude executable on the server (default: auto-detect). */
  remoteClaude?: string
  model?: string
  maxTurns: number
}

export interface ClaudeAnswer {
  text: string
  ok: boolean
  costUsd?: number
  durationMs?: number
}

function systemPrompt(cfg: ClaudeConfig) {
  return `${MEETING_CONTEXT(cfg.transcriptPath)}

- Do the task, using tools if useful.
- Nobody can answer follow-up questions or approve actions; make reasonable assumptions.
- Your final message is shown as a short popup in a terminal: answer in at most 3 short
  sentences of plain text, no markdown headings or tables. Mention any file you created or changed.`
}

export async function askClaude(
  transcript: string,
  request: string,
  cfg: ClaudeConfig
): Promise<ClaudeAnswer> {
  const prompt = `<meeting_transcript>\n${transcript}\n</meeting_transcript>\n\n<request>\n${request || "(no explicit request was spoken; infer what is most useful from the last part of the conversation)"}\n</request>`
  // Per request, so concurrent requests don't report each other's errors.
  let stderr = ""

  try {
    for await (const msg of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: REMOTE_EXECUTABLE_PLACEHOLDER,
        spawnClaudeCodeProcess: spawnOnServer(
          cfg.remoteClaude,
          (tail) => (stderr = tail)
        ),
        model: cfg.model,
        maxTurns: cfg.maxTurns,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemPrompt(cfg),
        },
        // Nobody can approve prompts mid-meeting: every tool is allowed.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (msg.type !== "result") continue
      if (msg.subtype === "success") {
        return {
          text: msg.result.trim(),
          ok: !msg.is_error,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
        }
      }
      return {
        text: `Claude stopped: ${msg.subtype}`,
        ok: false,
        costUsd: msg.total_cost_usd,
        durationMs: msg.duration_ms,
      }
    }
    return { text: "Claude returned no result.", ok: false }
  } catch (error) {
    const detail = stderr.trim().split("\n").slice(-3).join(" ")
    return {
      text: `Claude failed: ${(error as Error).message}${detail ? ` (${detail})` : ""}`,
      ok: false,
    }
  }
}
