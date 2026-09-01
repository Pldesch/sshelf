/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SlideDeckEditor", () => {
  it("only shows the Reveal preview", () => {
    const { container } = render(
      <SlideDeckEditor path="pitch.slides.html" content={deck} />
    )

    const iframe = container.querySelector("iframe")
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe?.srcdoc).toContain("Test deck")
    expect(iframe?.srcdoc).toContain("Reveal.initialize")
    expect(screen.queryByRole("button", { name: "Edit source" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByRole("button", { name: "Present" })).toBeTruthy()
  })
})
