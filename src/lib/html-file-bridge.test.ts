import { describe, expect, it } from "vitest"
import {
  HTML_FILE_BRIDGE_CHANNEL,
  assertEditableHtmlCompanion,
  parseHtmlFileBridgeRequest,
  resolveHtmlCompanionPath,
} from "./html-file-bridge"

describe("parseHtmlFileBridgeRequest", () => {
  it("accepts valid read and write requests", () => {
    expect(
      parseHtmlFileBridgeRequest({
        channel: HTML_FILE_BRIDGE_CHANNEL,
        type: "read-file",
        requestId: "read-1",
        path: "answers.json",
      })
    ).toMatchObject({ type: "read-file", path: "answers.json" })
    expect(
      parseHtmlFileBridgeRequest({
        channel: HTML_FILE_BRIDGE_CHANNEL,
        type: "write-file",
        requestId: "write-1",
        path: "answers.json",
        content: "{}",
      })
    ).toMatchObject({ type: "write-file", content: "{}" })
  })

  it("rejects unrelated and incomplete messages", () => {
    expect(parseHtmlFileBridgeRequest(null)).toBeNull()
    expect(
      parseHtmlFileBridgeRequest({
        channel: "another-app",
        type: "read-file",
        requestId: "1",
        path: "answers.json",
      })
    ).toBeNull()
    expect(
      parseHtmlFileBridgeRequest({
        channel: HTML_FILE_BRIDGE_CHANNEL,
        type: "write-file",
        requestId: "1",
        path: "answers.json",
      })
    ).toBeNull()
  })
})

describe("resolveHtmlCompanionPath", () => {
  it("keeps companion files inside the HTML directory", () => {
    expect(
      resolveHtmlCompanionPath("projects/demo/app.html", "answers.json")
    ).toBe("projects/demo/answers.json")
    expect(
      resolveHtmlCompanionPath("projects/demo/app.html", "data/state.json")
    ).toBe("projects/demo/data/state.json")
  })

  it("rejects absolute paths, traversal and self-overwrites", () => {
    expect(() =>
      resolveHtmlCompanionPath("projects/demo/app.html", "../secret.json")
    ).toThrow(/cannot leave/)
    expect(() =>
      resolveHtmlCompanionPath("projects/demo/app.html", "/etc/passwd")
    ).toThrow(/relative/)
    expect(() =>
      resolveHtmlCompanionPath("projects/demo/app.html", "app.html")
    ).toThrow(/overwrite itself/)
  })
})

describe("assertEditableHtmlCompanion", () => {
  it("allows text files and rejects executable HTML and binary files", () => {
    expect(() => assertEditableHtmlCompanion("answers.json")).not.toThrow()
    expect(() => assertEditableHtmlCompanion("notes.md")).not.toThrow()
    expect(() => assertEditableHtmlCompanion("other.html")).toThrow(/text/)
    expect(() => assertEditableHtmlCompanion("photo.png")).toThrow(/text/)
  })
})
