export type ByteRange = { start: number; end: number }

/** Parse one RFC 7233 byte range. Multipart ranges are intentionally rejected;
 * media/PDF clients retry with a single range and the raw endpoint stays
 * streamable through one SSH process. */
export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | "invalid" | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return "invalid"
  const [, startText, endText] = match
  if (!startText && !endText) return "invalid"

  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid"
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return "invalid"
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}
