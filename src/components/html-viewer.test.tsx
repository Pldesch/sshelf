/* @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HTML_FILE_BRIDGE_CHANNEL } from "@/lib/html-file-bridge"
import HtmlViewer from "./html-viewer"

const { readHtmlCompanionFile, writeHtmlCompanionFile } = vi.hoisted(() => ({
  readHtmlCompanionFile: vi.fn(),
  writeHtmlCompanionFile: vi.fn(),
}))

vi.mock("@/server/files", () => ({
  readHtmlCompanionFile,
  writeHtmlCompanionFile,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function sendFromPreview(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow,
    })
  )
}

describe("HtmlViewer file bridge", () => {
  it("reads a companion file and replies to the requesting iframe", async () => {
    readHtmlCompanionFile.mockResolvedValue({
      path: "demo/answers.json",
      content: '{"answer":42}',
    })
    const { container } = render(
      <HtmlViewer path="demo/workbook.html" content={null} />
    )
    const iframe = container.querySelector("iframe")
    expect(iframe?.contentWindow).toBeTruthy()

    const responses: Array<unknown> = []
    iframe?.contentWindow?.addEventListener("message", (event) =>
      responses.push(event.data)
    )
    sendFromPreview(iframe!, {
      channel: HTML_FILE_BRIDGE_CHANNEL,
      type: "read-file",
      requestId: "read-1",
      path: "answers.json",
    })

    await waitFor(() =>
      expect(readHtmlCompanionFile).toHaveBeenCalledWith({
        data: { htmlPath: "demo/workbook.html", path: "answers.json" },
      })
    )
    await waitFor(() =>
      expect(responses).toContainEqual({
        channel: HTML_FILE_BRIDGE_CHANNEL,
        type: "file-result",
        requestId: "read-1",
        ok: true,
        path: "demo/answers.json",
        content: '{"answer":42}',
      })
    )
  })

  it("writes companion content and rejects messages from another window", async () => {
    writeHtmlCompanionFile.mockResolvedValue({
      ok: true,
      path: "demo/answers.json",
    })
    const { container } = render(
      <HtmlViewer path="demo/workbook.html" content={null} />
    )
    const iframe = container.querySelector("iframe")!
    const request = {
      channel: HTML_FILE_BRIDGE_CHANNEL,
      type: "write-file",
      requestId: "write-1",
      path: "answers.json",
      content: '{"answer":43}',
    }

    window.dispatchEvent(
      new MessageEvent("message", { data: request, source: window })
    )
    expect(writeHtmlCompanionFile).not.toHaveBeenCalled()

    sendFromPreview(iframe, request)
    await waitFor(() =>
      expect(writeHtmlCompanionFile).toHaveBeenCalledWith({
        data: {
          htmlPath: "demo/workbook.html",
          path: "answers.json",
          content: '{"answer":43}',
        },
      })
    )
  })
})
