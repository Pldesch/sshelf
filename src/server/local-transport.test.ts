import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { contentRevision } from "./content-revision"
import type * as SshTransport from "./ssh"

const root = mkdtempSync(join(tmpdir(), "sshelf-local-integration-"))
let transport: typeof SshTransport

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("SSHELF_TRANSPORT", "local")
  vi.stubEnv("SSHELF_LOCAL_ROOT", root)
  transport = await import("./ssh")
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe("local transport", () => {
  it("runs commands in the configured root without an SSH host", async () => {
    expect(transport.TRANSPORT_MODE).toBe("local")
    expect(transport.getCurrentHost()).toBe("local")
    expect(transport.listSshConfigHosts()).toEqual([
      { alias: "local", hostName: root },
    ])
    expect((await transport.runRemote("pwd")).trim()).toBe(root)
    expect(() => transport.setSshHost("remote-host")).toThrow(
      /cannot be selected/
    )
  })

  it("writes, revision-checks, reads, and range-streams local files", async () => {
    const initial = Buffer.from("0123456789", "utf-8")
    await transport.writeRemoteFile("nested/example.txt", initial)

    const read = await transport.readRemoteFile("nested/example.txt")
    expect(read.value).toEqual(initial)

    const replacement = Buffer.from("abcdefghij", "utf-8")
    await transport.writeRemoteFileIfRevision(
      "nested/example.txt",
      replacement,
      contentRevision(initial)
    )
    await expect(
      transport.writeRemoteFileIfRevision(
        "nested/example.txt",
        Buffer.from("stale", "utf-8"),
        contentRevision(initial)
      )
    ).rejects.toThrow(/SSHELF_EDIT_CONFLICT/)
    expect(readFileSync(join(root, "nested/example.txt"))).toEqual(replacement)

    const chunks: Array<Uint8Array> = []
    for await (const chunk of transport.streamRemoteFile("nested/example.txt", {
      start: 2,
      end: 5,
    })) {
      chunks.push(chunk)
    }
    expect(Buffer.concat(chunks).toString("utf-8")).toBe("cdef")
  })
})
