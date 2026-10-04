/* Shapes shared by the meeting page and its server functions. */

export interface MeetingSegment {
  /** Assigned by the page, increasing within a meeting. */
  seq: number
  /** ISO timestamp of when the segment was committed. */
  at: string
  text: string
}

/** Marks transcript lines that were typed to Claude rather than spoken. */
export const TYPED_PREFIX = "(typed) "

/** The in-meeting assistant, or the session that ingests the transcript. */
export type SessionKind = "meeting" | "ingest"

export type MeetingEventBody =
  | { type: "asked"; kind: SessionKind; askId: string; steering: boolean }
  | { type: "activity"; askIds: Array<string>; text: string }
  | {
      type: "answer"
      askIds: Array<string>
      ok: boolean
      text: string
      costUsd?: number
      durationMs?: number
    }
  | { type: "sync"; ok: boolean; error?: string }
  | {
      type: "session"
      kind: SessionKind
      sessionId: string
      /** Absolute directory Claude Code runs in on the server. */
      cwd: string
      /** Command to continue this session in a terminal. */
      resumeCommand: string
    }
  | {
      type: "ended"
      transcriptPath: string
      /** Workspace-relative folder the ingest session will run in. */
      ingestDir: string
    }

export type MeetingEvent = { seq: number } & MeetingEventBody

export interface MeetingInfo {
  id: string
  title: string
  transcriptPath: string
}
