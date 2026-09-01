import { describe, expect, it } from "vitest"
import {
  extensionOf,
  fileKindOf,
  formatBytes,
  mimeTypeOf,
  nameOf,
  parentOf,
  rawFileUrl,
} from "./file-kinds"

describe("extensionOf", () => {
  it("returns the lowercased extension", () => {
    expect(extensionOf("a.md")).toBe("md")
    expect(extensionOf("FILE.PDF")).toBe("pdf")
  })

  it("returns empty string when there is no extension", () => {
    expect(extensionOf("noext")).toBe("")
  })

  it("treats a leading dot as no extension", () => {
    expect(extensionOf(".bashrc")).toBe("")
  })

  it("uses the last dot for multi-dot names", () => {
    expect(extensionOf("a.tar.gz")).toBe("gz")
  })
})

describe("fileKindOf", () => {
  it("detects markdown", () => {
    expect(fileKindOf("a.md")).toBe("markdown")
    expect(fileKindOf("a.mdx")).toBe("markdown")
    expect(fileKindOf("a.markdown")).toBe("markdown")
  })

  it("detects pdf", () => {
    expect(fileKindOf("a.pdf")).toBe("pdf")
  })

  it("detects databases", () => {
    expect(fileKindOf("a.db")).toBe("database")
    expect(fileKindOf("a.sqlite")).toBe("database")
    expect(fileKindOf("a.sqlite3")).toBe("database")
  })

  it("detects Word documents", () => {
    expect(fileKindOf("a.doc")).toBe("word")
    expect(fileKindOf("a.docx")).toBe("word")
    expect(fileKindOf("a.docm")).toBe("word")
  })

  it("detects Excel workbooks", () => {
    expect(fileKindOf("a.xls")).toBe("spreadsheet")
    expect(fileKindOf("a.xlsx")).toBe("spreadsheet")
    expect(fileKindOf("a.xlsm")).toBe("spreadsheet")
  })

  it("detects html", () => {
    expect(fileKindOf("a.html")).toBe("html")
    expect(fileKindOf("a.htm")).toBe("html")
  })

  it("detects images", () => {
    expect(fileKindOf("a.png")).toBe("image")
    expect(fileKindOf("a.jpg")).toBe("image")
    expect(fileKindOf("a.svg")).toBe("image")
  })

  it("detects text", () => {
    expect(fileKindOf("a.txt")).toBe("text")
    expect(fileKindOf("a.json")).toBe("text")
    expect(fileKindOf("a.ts")).toBe("text")
    expect(fileKindOf("a.py")).toBe("text")
  })

  it("falls back to other for unknown extensions", () => {
    expect(fileKindOf("a.bin")).toBe("other")
    expect(fileKindOf("noext")).toBe("other")
  })
})

describe("mimeTypeOf", () => {
  it("maps known extensions", () => {
    expect(mimeTypeOf("x.pdf")).toBe("application/pdf")
    expect(mimeTypeOf("x.png")).toBe("image/png")
    expect(mimeTypeOf("x.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    expect(mimeTypeOf("x.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  })

  it("falls back to octet-stream for unknown extensions", () => {
    expect(mimeTypeOf("x.bin")).toBe("application/octet-stream")
  })
})

describe("formatBytes", () => {
  it("formats small byte counts", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })

  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
  })

  it("formats multi-megabyte values in MB", () => {
    expect(formatBytes(5 * 1024 * 1024).endsWith(" MB")).toBe(true)
  })
})

describe("parentOf", () => {
  it("returns the parent directory", () => {
    expect(parentOf("a/b/c.md")).toBe("a/b")
  })

  it("returns empty string for a top-level path", () => {
    expect(parentOf("c.md")).toBe("")
  })
})

describe("nameOf", () => {
  it("returns the final segment", () => {
    expect(nameOf("a/b/c.md")).toBe("c.md")
  })

  it("returns the whole name for a top-level path", () => {
    expect(nameOf("c.md")).toBe("c.md")
  })
})

describe("rawFileUrl", () => {
  it("builds an encoded raw url", () => {
    const url = rawFileUrl("a b.md")
    expect(url).toContain("/api/raw?path=")
    expect(url).toContain("a+b.md")
  })

  it("adds download=1 when requested", () => {
    expect(rawFileUrl("a b.md", true)).toContain("download=1")
  })
})
