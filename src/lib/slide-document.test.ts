/* @vitest-environment jsdom */

// @ts-expect-error jsdom does not bundle TypeScript declarations
import { JSDOM } from "jsdom"
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
    expect(html).toContain('data-sshelf-edit-key="0.0"')
    expect(html).toContain("Test deck")
    expect(html).toContain(".accent { color: tomato; }")
    expect(html).toContain("html, body { height: 100%; }")
    expect(html).toContain("width: 100%;\n  height: 100%;")
    expect(html).toContain(".reveal-viewport,\n.reveal {")
    expect(html).toContain("background-color: #fff !important;")
    expect(html).toContain(".reveal .backgrounds .slide-background {")
    expect(html).toContain("background: #fff !important;")
    expect(html).toContain("html body .reveal .slides > section:not(.stack),\n")
    expect(html).toContain(
      "html body .reveal .slides .pdf-page > section:not(.stack)"
    )
    expect(html).toContain("--sshelf-slide-width: 960px;")
    expect(html).toContain("--sshelf-slide-height: 700px;")
    expect(html).toContain("width: var(--sshelf-slide-width) !important;")
    expect(html).toContain("height: var(--sshelf-slide-height) !important;")
    expect(html).toContain("width: 960,")
    expect(html).toContain("height: 700,")
    expect(html).toContain("margin: 0,")
    expect(html).toContain("overflow: hidden;")
    expect(html).toContain("window.Reveal")
    expect(html).toContain('type: "edit-request"')
    expect(html).toContain("/api/raw?path=decks%2Fimages%2Fdiagram.png")
    expect(html).not.toContain("window.evil")
    expect(html).not.toContain("javascript:alert")
    expect(html).toContain("Content-Security-Policy")
  })

  it.each([
    [1280, 720, 0],
    [1024, 768, 0.04],
    [720, 1280, 0.1],
  ])(
    "uses %sx%s deck geometry with margin %s in preview and print documents",
    (width, height, margin) => {
      const geometrySource = source.replace(
        'data-sshelf-slides="1"',
        `data-sshelf-slides="1" data-slide-width="${width}" data-slide-height="${height}" data-slide-margin="${margin}"`
      )
      const options = {
        source: geometrySource,
        path: "decks/custom-size.slides.html",
        resetCss: "",
        revealCss: "",
        themeCss: "",
        revealScript: "window.Reveal = revealStub",
      }
      const preview = buildSlideSrcDoc(options)
      const print = buildSlideSrcDoc({ ...options, mode: "print" })

      for (const html of [preview, print]) {
        expect(html).toContain(`--sshelf-slide-width: ${width}px;`)
        expect(html).toContain(`--sshelf-slide-height: ${height}px;`)
        expect(html).toContain(`width: ${width},`)
        expect(html).toContain(`height: ${height},`)
        expect(html).toContain(`margin: ${margin},`)
      }
    }
  )

  it.each([
    ["data-slide-width", "0"],
    ["data-slide-height", "not-a-number"],
    ["data-slide-margin", "0.75"],
  ])("rejects invalid %s metadata", (attribute, value) => {
    const invalidSource = source.replace(
      'data-sshelf-slides="1"',
      `data-sshelf-slides="1" ${attribute}="${value}"`
    )

    expect(() =>
      buildSlideSrcDoc({
        source: invalidSource,
        path: "decks/invalid.slides.html",
        resetCss: "",
        revealCss: "",
        themeCss: "",
        revealScript: "",
      })
    ).toThrow(attribute)
  })

  it("uses a full-bleed page when deck metadata omits the margin", () => {
    const html = buildSlideSrcDoc({
      source,
      path: "decks/full-bleed.slides.html",
      resetCss: "",
      revealCss: "",
      themeCss: "",
      revealScript: "window.Reveal = revealStub",
      mode: "print",
    })

    expect(html).toContain("margin: 0,")
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

  it("builds a Reveal print document without preview editing metadata", () => {
    const html = buildSlideSrcDoc({
      source,
      path: "decks/pitch.slides.html",
      resetCss: "",
      revealCss: "",
      themeCss: "",
      revealScript: "window.Reveal = revealStub",
      mode: "print",
    })

    expect(html).toContain('view: "print"')
    expect(html).toContain("pdfSeparateFragments: false")
    expect(html).toContain('type: "pdf-ready"')
    expect(html).toContain("window.print()")
    expect(html).not.toContain("data-sshelf-edit-key")
    expect(html).not.toContain('type: "edit-request"')
  })

  it("preserves authored slide spacing and layouts in Reveal print mode", async () => {
    const printSource = `<!doctype html>
<html>
  <head>
    <style>
      .reveal .slides section { padding: 72px 80px; }
      .closing { display: grid !important; }
    </style>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section class="closing"><h1>Closing slide</h1></section>
      </div>
    </div>
  </body>
</html>`
    const revealScript = `window.Reveal = {
  listeners: {},
  on: function (name, listener) { this.listeners[name] = listener },
  initialize: function () {
    document.documentElement.classList.add("reveal-print")
    this.listeners["pdf-ready"]()
    return Promise.resolve()
  }
}`
    const html = buildSlideSrcDoc({
      source: printSource,
      path: "decks/pitch.slides.html",
      resetCss: "",
      revealCss:
        "html.reveal-print .reveal .slides section { padding: 0 !important; display: block !important; }",
      themeCss: "",
      revealScript,
      mode: "print",
    })
    const dom = new JSDOM(html, { runScripts: "dangerously" })

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0))

    const slide = dom.window.document.querySelector<HTMLElement>(".closing")
    if (!slide) throw new Error("Expected the closing slide to exist")
    expect(slide.style.getPropertyValue("padding-top")).toBe("72px")
    expect(slide.style.getPropertyPriority("padding-top")).toBe("important")
    expect(slide.style.getPropertyValue("display")).toBe("grid")
    expect(slide.style.getPropertyPriority("display")).toBe("important")
    expect(dom.window.getComputedStyle(slide).paddingLeft).toBe("80px")
    expect(dom.window.getComputedStyle(slide).display).toBe("grid")

    dom.window.close()
  })
})
