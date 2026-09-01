/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest"
import { buildSlideSrcDoc } from "./slide-document"

const source = `<!doctype html>
<html data-sshelf-slides="1">
  <head>
    <style data-deck-style>.accent { color: tomato; }</style>
    <script>window.evil = true</script>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section data-slide-id="intro" onclick="window.evil = true">
          <h1>Test deck</h1>
          <img src="images/diagram.png" alt="Diagram">
        </section>
        <section><a href="javascript:alert(1)">Unsafe link</a></section>
      </div>
    </div>
  </body>
</html>`

describe("buildSlideSrcDoc", () => {
  it("builds a sandbox-ready Reveal document from deck HTML", () => {
    const html = buildSlideSrcDoc({
      source,
      path: "decks/pitch.slides.html",
      resetCss: "html, body { height: 100%; }",
      revealCss: ".reveal { display: block; }",
      themeCss: ".reveal { color: black; }",
      revealScript: "window.Reveal = { initialize: () => Promise.resolve() }",
    })

    expect(html).toContain('class="reveal"')
    expect(html).toContain('data-slide-id="intro"')
    expect(html).toContain("Test deck")
    expect(html).toContain(".accent { color: tomato; }")
    expect(html).toContain("html, body { height: 100%; }")
    expect(html).toContain("width: 100%;\n  height: 100%;")
    expect(html).toContain(".reveal-viewport,\n.reveal {")
    expect(html).toContain("background-color: #fff !important;")
    expect(html).toContain(".reveal .backgrounds .slide-background {")
    expect(html).toContain("background: #fff !important;")
    expect(html).toContain(".reveal .slides > section,\n")
    expect(html).toContain("overflow: hidden;")
    expect(html).toContain("window.Reveal")
    expect(html).toContain("/api/raw?path=decks%2Fimages%2Fdiagram.png")
    expect(html).not.toContain("window.evil")
    expect(html).not.toContain("javascript:alert")
    expect(html).toContain("Content-Security-Policy")
  })

  it("rejects files without a Reveal slide container", () => {
    expect(() =>
      buildSlideSrcDoc({
        source: "<html><body><h1>Not a deck</h1></body></html>",
        path: "broken.slides.html",
        resetCss: "",
        revealCss: "",
        themeCss: "",
        revealScript: "",
      })
    ).toThrow(/\.reveal > \.slides/)
  })
})
