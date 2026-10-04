// Speech-to-text often mis-hears "Claude"; these spellings all count as the default trigger.
export const DEFAULT_TRIGGERS = [
  "hey claude",
  "hey cloud",
  "hey claud",
  "hey clode",
  "hey clawed",
  "hey klaud",
]

export function buildTriggerRegex(phrases: string[]): RegExp {
  const alternatives = phrases.map((p) =>
    p
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s,.!?'-]+")
  )
  return new RegExp(`\\b(?:${alternatives.join("|")})\\b[\\s,.!?:'-]*`, "i")
}

/** Returns the text spoken after the trigger, or null if the segment has no trigger. */
export function findTrigger(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  if (!m) return null
  return text.slice(m.index + m[0].length).trim()
}

/** The trigger regex used by the meeting page (detection and highlighting). */
export const DEFAULT_TRIGGER_RE = buildTriggerRegex(DEFAULT_TRIGGERS)
