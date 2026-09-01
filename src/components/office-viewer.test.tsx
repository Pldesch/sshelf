/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import OfficeViewer from "./office-viewer"

const { fileViewerSpy } = vi.hoisted(() => ({
  fileViewerSpy: vi.fn(),
}))

vi.mock("@file-viewer/react", () => ({
  default: (props: unknown) => {
    fileViewerSpy(props)
    return null
  },
}))

vi.mock("@file-viewer/renderer-word", () => ({
  wordRenderer: { id: "word" },
}))

vi.mock("@file-viewer/renderer-spreadsheet", () => ({
  spreadsheetRenderer: { id: "spreadsheet" },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("OfficeViewer", () => {
  it("keeps viewer options stable across explorer renders", () => {
    const view = render(<OfficeViewer path="reports/demo.docx" size={1024} />)
    const firstOptions = fileViewerSpy.mock.lastCall?.[0].options
    expect(firstOptions).toBeDefined()

    view.rerender(<OfficeViewer path="reports/demo.docx" size={1024} />)

    expect(fileViewerSpy.mock.lastCall?.[0].options).toBe(firstOptions)
  })
})
