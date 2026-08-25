import { createHash } from "node:crypto"

export function contentRevision(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}

export function isContentRevision(value: string): boolean {
  return /^[a-f\d]{64}$/.test(value)
}
