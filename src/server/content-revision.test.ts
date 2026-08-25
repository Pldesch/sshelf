import { describe, expect, it } from "vitest"
import { contentRevision, isContentRevision } from "./content-revision"

describe("contentRevision", () => {
  it("is deterministic and changes with content", () => {
    expect(contentRevision("hello")).toBe(contentRevision(Buffer.from("hello")))
    expect(contentRevision("hello")).not.toBe(contentRevision("hello!"))
  })

  it("produces a valid SHA-256 revision", () => {
    const revision = contentRevision("document")
    expect(revision).toHaveLength(64)
    expect(isContentRevision(revision)).toBe(true)
    expect(isContentRevision("not-a-revision")).toBe(false)
  })
})
