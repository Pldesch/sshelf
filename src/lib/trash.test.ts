import { describe, expect, it } from "vitest"
import { isManagedTrashPath, MANAGED_TRASH_DIRECTORY } from "./trash"

describe("isManagedTrashPath", () => {
  it("accepts direct children of the managed trash directory", () => {
    expect(isManagedTrashPath(`${MANAGED_TRASH_DIRECTORY}/item`)).toBe(true)
  })

  it("rejects the directory itself and lookalike paths", () => {
    expect(isManagedTrashPath(MANAGED_TRASH_DIRECTORY)).toBe(false)
    expect(isManagedTrashPath(".sshelf-trash-old/item")).toBe(false)
    expect(isManagedTrashPath("folder/.sshelf-trash/item")).toBe(false)
    expect(isManagedTrashPath(".sshelf-trash/folder/item")).toBe(false)
  })
})
