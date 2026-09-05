import { describe, expect, it } from "vitest"
import {
  normalizeEstradeckAssetReference,
  normalizeEstradeckChangedFile,
} from "./estradeck"

describe("Estradeck bridge path validation", () => {
  it("accepts only deck files and bounded asset folders", () => {
    expect(normalizeEstradeckChangedFile("presentation.html")).toBe(
      "presentation.html"
    )
    expect(normalizeEstradeckChangedFile("styles.css")).toBe("styles.css")
    expect(normalizeEstradeckChangedFile("images/chart.png")).toBe(
      "images/chart.png"
    )
    expect(normalizeEstradeckChangedFile("videos/demo.mp4")).toBe(
      "videos/demo.mp4"
    )
    expect(normalizeEstradeckChangedFile("../presentation.html")).toBeNull()
    expect(normalizeEstradeckChangedFile("images/../../secret")).toBeNull()
    expect(normalizeEstradeckChangedFile("scripts/payload.js")).toBeNull()
  })

  it("mirrors only relative references that stay inside the deck", () => {
    expect(normalizeEstradeckAssetReference("images/chart.png?v=2")).toBe(
      "images/chart.png"
    )
    expect(normalizeEstradeckAssetReference("./media/demo.mp4")).toBe(
      "media/demo.mp4"
    )
    expect(normalizeEstradeckAssetReference("../../etc/passwd")).toBeNull()
    expect(normalizeEstradeckAssetReference("/etc/passwd")).toBeNull()
    expect(
      normalizeEstradeckAssetReference("https://example.com/image.png")
    ).toBeNull()
  })
})
