/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest"
import { annotateSlideTextTargets, applySlideTextEdit } from "./slide-editing"

const source = `<!doctype html>
<html data-sshelf-slides="1">
  <head><style>.accent { color: tomato; }</style></head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section class="cover">
          <div class="eyebrow">Runtime only</div>
          <h1>Pitch <strong>decks</strong></h1>
          <p>Keep the source readable.</p>
        </section>
      </div>
    </div>
  </body>
</html>`

describe("slide text editing", () => {
  it("adds temporary keys only to the rendered slide clone", () => {
    const parsed = new DOMParser().parseFromString(source, "text/html")
    const slides = parsed.querySelector(".reveal > .slides")
    if (!slides) throw new Error("fixture is missing slides")

    expect(annotateSlideTextTargets(slides)).toBe(3)
    expect(
      [...slides.querySelectorAll("[data-sshelf-edit-key]")].map((element) =>
        element.getAttribute("data-sshelf-edit-key")
      )
    ).toEqual(["0.0", "0.1", "0.2"])
    expect(source).not.toContain("data-sshelf-edit-key")
  })

  it("patches only the selected element's source range", () => {
    const edited = applySlideTextEdit(source, {
      key: "0.1",
      html: "Pitch <em>documents</em>",
    })

    expect(edited.html).toBe("Pitch <em>documents</em>")
    expect(edited.source).toBe(
      source.replace("Pitch <strong>decks</strong>", "Pitch <em>documents</em>")
    )
    expect(edited.source).not.toContain("data-sshelf-edit-key")
  })

  it("removes runtime metadata and unsafe markup from edits", () => {
    const edited = applySlideTextEdit(source, {
      key: "0.2",
      html: 'Safe <span data-sshelf-edit-key="bad" onclick="alert(1)">text</span><script>alert(2)</script>',
    })

    expect(edited.html).toBe("Safe <span>text</span>")
    expect(edited.source).toContain("Safe <span>text</span>")
    expect(edited.source).not.toContain("data-sshelf-edit-key")
    expect(edited.source).not.toContain("onclick")
    expect(edited.source).not.toContain("<script")
  })

  it("rejects paths that do not identify authored elements", () => {
    expect(() =>
      applySlideTextEdit(source, { key: "9.9", html: "Missing" })
    ).toThrow(/editable text target/i)
  })
})
