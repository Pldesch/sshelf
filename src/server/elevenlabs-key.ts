import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/* The ElevenLabs API key, saved from the Meeting page. One per user of this
   computer, readable only by them. Separate from ~/.sshelf.json, which the
   SSH layer rewrites wholesale. */

const CONFIG_FILE = join(homedir(), ".sshelf-meeting.json")

export function readElevenLabsKey(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as {
      elevenLabsApiKey?: string
    }
    return parsed.elevenLabsApiKey || null
  } catch {
    return null
  }
}

/** Written to a fresh 0600 file then renamed over the old one, so the key is
 * never readable by others, even briefly. */
export function writeElevenLabsKey(key: string | null) {
  const temp = `${CONFIG_FILE}.${process.pid}.tmp`
  rmSync(temp, { force: true })
  writeFileSync(temp, JSON.stringify(key ? { elevenLabsApiKey: key } : {}), {
    mode: 0o600,
    flag: "wx",
  })
  renameSync(temp, CONFIG_FILE)
}
