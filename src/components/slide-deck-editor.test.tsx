/* @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import SlideDeckEditor from "./slide-deck-editor"

const deck = `<!doctype html>
<html data-sshelf-slides="1">
  <head><style>.reveal h1 { color: tomato; }</style></head>
  <body>
    <div class="reveal"><div class="slides">
      <section><h1>Test deck</h1></section>
      <section><p>Second slide</p></section>
    </div></div>
  </body>
</html>`

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  })
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SlideDeckEditor", () => {
  it("only shows the Reveal preview", () => {
    const { container } = render(
      <SlideDeckEditor
        path="pitch.slides.html"
        content={deck}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe?.srcdoc).toContain("Test deck")
    expect(iframe?.srcdoc).toContain("Reveal.initialize")
    expect(screen.queryByRole("button", { name: "Edit source" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Present" })).toBeTruthy()
  })

  it("prepares Reveal print mode and opens the PDF print flow", async () => {
    const { container } = render(
      <SlideDeckEditor
        path="pitch.slides.html"
        content={deck}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }))

    const pdfIframe = await screen.findByTitle("PDF export")
    expect(pdfIframe.getAttribute("sandbox")).toBe("allow-scripts allow-modals")
    expect(pdfIframe.getAttribute("aria-hidden")).toBe("true")
    expect(pdfIframe.getAttribute("srcdoc")).toContain('view: "print"')
    expect(pdfIframe.getAttribute("srcdoc")).not.toContain(
      "data-sshelf-edit-key"
    )
    expect(
      screen
        .getByRole("button", {
          name: "Preparing PDF…",
        })
        .hasAttribute("disabled")
    ).toBe(true)

    if (!(pdfIframe instanceof HTMLIFrameElement) || !pdfIframe.contentWindow) {
      throw new Error("PDF iframe was not rendered")
    }
    const postMessage = vi.spyOn(pdfIframe.contentWindow, "postMessage")
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: pdfIframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "pdf-ready" },
        })
      )
    })
    expect(postMessage).toHaveBeenCalledWith(
      { channel: "sshelf:slides:v1", type: "print-pdf" },
      "*"
    )
    expect(
      screen
        .getByRole("button", {
          name: "Save as PDF…",
        })
        .hasAttribute("disabled")
    ).toBe(true)

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: pdfIframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "pdf-finished" },
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByTitle("PDF export")).toBeNull()
    })
    expect(
      screen
        .getByRole("button", {
          name: "Export PDF",
        })
        .hasAttribute("disabled")
    ).toBe(false)
    expect(container.querySelectorAll("iframe")).toHaveLength(1)
  })

  it("edits a runtime target and saves metadata-free source", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <SlideDeckEditor
        path="pitch.slides.html"
        content={deck}
        onSave={onSave}
      />
    )
    const iframe = container.querySelector("iframe")
    if (!iframe?.contentWindow)
      throw new Error("preview iframe was not rendered")

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "ready" },
        })
      )
    })
    expect(iframe.getAttribute("data-ready")).toBe("true")

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            channel: "sshelf:slides:v1",
            type: "edit-request",
            key: "0.0",
            html: "Test deck",
            rect: { x: 20, y: 30, width: 240, height: 60 },
            style: {
              color: "rgb(0, 0, 0)",
              fontFamily: "sans-serif",
              fontFeatureSettings: '"liga" 1',
              fontKerning: "normal",
              fontOpticalSizing: "auto",
              fontSize: "32px",
              fontStyle: "normal",
              fontStretch: "normal",
              fontVariant: "small-caps",
              fontVariationSettings: '"wght" 700',
              fontWeight: "700",
              letterSpacing: "normal",
              lineHeight: "38px",
              textAlign: "left",
              textDecoration: "none",
              textRendering: "auto",
              textTransform: "none",
              whiteSpace: "normal",
              wordSpacing: "2px",
            },
          },
        })
      )
    })

    const editor = await screen.findByLabelText("Edit slide text")
    expect(editor.textContent).toBe("Test deck")
    expect(editor.getAttribute("style")).toContain(
      "font-feature-settings: inherit"
    )
    const overlay = editor.closest("[data-slide-text-editor]") as HTMLElement
    expect(overlay.style.fontFeatureSettings).toBe('"liga" 1')
    expect(overlay.style.fontVariant).toBe("small-caps")
    expect(overlay.style.textRendering).toBe("auto")
    expect(overlay.style.whiteSpace).toBe("normal")
    editor.innerHTML = "Edited deck"
    fireEvent.input(editor, { inputType: "insertText", data: "Edited deck" })

    await waitFor(
      () => {
        expect(onSave).toHaveBeenCalledWith(
          expect.stringContaining("Edited deck")
        )
      },
      { timeout: 2_000 }
    )
    const saved = onSave.mock.calls.at(-1)?.[0] as string
    expect(saved).not.toContain("data-sshelf-edit-key")
    expect(saved).not.toContain("ProseMirror")
  })

  it("reverts complete edit sessions from memory", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { container, rerender, unmount } = render(
      <SlideDeckEditor
        path="pitch.slides.html"
        content={deck}
        onSave={onSave}
      />
    )
    const iframe = container.querySelector("iframe")
    if (!iframe?.contentWindow)
      throw new Error("preview iframe was not rendered")

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            channel: "sshelf:slides:v1",
            type: "edit-request",
            key: "0.0",
            html: "Test deck",
            rect: { x: 20, y: 30, width: 240, height: 60 },
            style: {},
          },
        })
      )
    })

    const editor = await screen.findByLabelText("Edit slide text")
    editor.innerHTML = "Edited once"
    fireEvent.input(editor, { inputType: "insertText", data: "Edited once" })
    editor.innerHTML = "Edited twice"
    fireEvent.input(editor, { inputType: "insertText", data: "Edited twice" })
    expect(await screen.findByRole("button", { name: "Revert" })).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "edit-dismiss" },
        })
      )
    })
    await waitFor(() => {
      expect(onSave.mock.calls.at(-1)?.[0]).toContain("Edited twice")
    })

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            channel: "sshelf:slides:v1",
            type: "edit-request",
            key: "0.0",
            html: "Edited twice",
            rect: { x: 20, y: 30, width: 240, height: 60 },
            style: {},
          },
        })
      )
    })
    const secondEditor = await screen.findByLabelText("Edit slide text")
    secondEditor.innerHTML = "Final edit"
    fireEvent.input(secondEditor, {
      inputType: "insertText",
      data: "Final edit",
    })
    await waitFor(
      () => {
        expect(onSave.mock.calls.at(-1)?.[0]).toContain("Final edit")
      },
      { timeout: 2_000 }
    )
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "edit-dismiss" },
        })
      )
    })

    fireEvent.click(screen.getByRole("button", { name: "Revert" }))
    await waitFor(() => {
      expect(onSave.mock.calls.at(-1)?.[0]).toContain("Edited twice")
    })
    expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Revert" }))

    await waitFor(() => {
      expect(onSave.mock.calls.at(-1)?.[0]).toBe(deck)
    })
    const revertedIframe = container.querySelector("iframe")
    expect(revertedIframe?.srcdoc).toContain("Test deck")
    expect(revertedIframe?.srcdoc).not.toContain("Edited twice")
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()

    if (!revertedIframe?.contentWindow)
      throw new Error("reverted preview iframe was not rendered")
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: revertedIframe.contentWindow,
          data: {
            channel: "sshelf:slides:v1",
            type: "edit-request",
            key: "0.0",
            html: "Test deck",
            rect: { x: 20, y: 30, width: 240, height: 60 },
            style: {},
          },
        })
      )
    })
    const nextEditor = await screen.findByLabelText("Edit slide text")
    nextEditor.innerHTML = "Another edit"
    fireEvent.input(nextEditor, {
      inputType: "insertText",
      data: "Another edit",
    })
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: revertedIframe.contentWindow,
          data: { channel: "sshelf:slides:v1", type: "edit-dismiss" },
        })
      )
    })
    expect(await screen.findByRole("button", { name: "Revert" })).toBeTruthy()

    rerender(
      <SlideDeckEditor
        path="another.slides.html"
        content={deck}
        onSave={onSave}
      />
    )
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
    })

    unmount()
    render(
      <SlideDeckEditor
        path="pitch.slides.html"
        content={deck}
        onSave={onSave}
      />
    )
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull()
  }, 10_000)
})
