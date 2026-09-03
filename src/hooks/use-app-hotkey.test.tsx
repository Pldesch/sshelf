/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAppHotkey } from "./use-app-hotkey"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function ShortcutInput({
  allowInEditable = false,
  onTrigger,
  onKeyDown,
}: {
  allowInEditable?: boolean
  onTrigger: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}) {
  useAppHotkey("Mod+P", onTrigger, {
    allowInEditable,
    requireReset: true,
  })
  return <input aria-label="Search" onKeyDown={onKeyDown} />
}

describe("useAppHotkey", () => {
  it("can explicitly allow an app shortcut while typing", () => {
    const onTrigger = vi.fn()
    render(<ShortcutInput allowInEditable onTrigger={onTrigger} />)

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "p",
      ctrlKey: true,
    })

    expect(onTrigger).toHaveBeenCalledOnce()
  })

  it("still yields when an editable child handled the shortcut", () => {
    const onTrigger = vi.fn()
    render(
      <ShortcutInput
        allowInEditable
        onKeyDown={(event) => event.preventDefault()}
        onTrigger={onTrigger}
      />
    )

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "p",
      ctrlKey: true,
    })

    expect(onTrigger).not.toHaveBeenCalled()
  })
})
