/* @vitest-environment jsdom */

import * as React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarProvider } from "./sidebar"

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderProvider(child: React.ReactNode) {
  const onOpenChange = vi.fn()
  render(
    <SidebarProvider open onOpenChange={onOpenChange}>
      {child}
    </SidebarProvider>
  )
  return onOpenChange
}

function pressSidebarShortcut(target: Element, init?: KeyboardEventInit) {
  fireEvent.keyDown(target, {
    key: "b",
    ctrlKey: true,
    ...init,
  })
}

describe("SidebarProvider keyboard shortcut", () => {
  it("toggles from ordinary page content", () => {
    const onOpenChange = renderProvider(
      <button type="button">Page action</button>
    )

    pressSidebarShortcut(screen.getByRole("button", { name: "Page action" }))

    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each([
    ["input", <input aria-label="Title" key="input" />],
    ["textarea", <textarea aria-label="Notes" key="textarea" />],
    [
      "contenteditable",
      <div aria-label="Editor" contentEditable key="editor" role="textbox" />,
    ],
  ])("does not toggle from a %s", (_name, control) => {
    const onOpenChange = renderProvider(control)

    pressSidebarShortcut(screen.getByRole("textbox"))

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("does not toggle when a child already handled the event", () => {
    const onOpenChange = renderProvider(
      <button type="button" onKeyDown={(event) => event.preventDefault()}>
        Local shortcut
      </button>
    )

    pressSidebarShortcut(screen.getByRole("button", { name: "Local shortcut" }))

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("does not toggle inside an explicit app-shortcut opt-out region", () => {
    const onOpenChange = renderProvider(
      <div data-app-shortcuts="off">
        <button type="button">Visualization control</button>
      </div>
    )

    pressSidebarShortcut(
      screen.getByRole("button", { name: "Visualization control" })
    )

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each([
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])("does not toggle for Ctrl+%s+B", (_name, init) => {
    const onOpenChange = renderProvider(
      <button type="button">Page action</button>
    )

    pressSidebarShortcut(
      screen.getByRole("button", { name: "Page action" }),
      init
    )

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("does not toggle for a repeated keydown event", () => {
    const onOpenChange = renderProvider(
      <button type="button">Page action</button>
    )

    pressSidebarShortcut(screen.getByRole("button", { name: "Page action" }), {
      repeat: true,
    })

    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
