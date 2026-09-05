import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  resolveTransportConfig,
  resolveTransportPath,
} from "./transport-config"
import type { TransportConfig } from "./transport-config"

const DEVELOPMENT_RUNTIME = {
  isProduction: false,
  platform: process.platform,
} as const

describe("resolveTransportConfig", () => {
  it("defaults to SSH with the existing remote root", () => {
    expect(resolveTransportConfig({}, DEVELOPMENT_RUNTIME)).toEqual({
      mode: "ssh",
      root: "/home/ubuntu",
    })
  })

  it("accepts an explicit local root in development", () => {
    const root = mkdtempSync(join(tmpdir(), "sshelf-local-root-"))
    expect(
      resolveTransportConfig(
        {
          NODE_ENV: "development",
          SSHELF_TRANSPORT: "local",
          SSHELF_LOCAL_ROOT: root,
        },
        DEVELOPMENT_RUNTIME
      )
    ).toEqual({ mode: "local", root })
  })

  it("rejects local transport in a production build", () => {
    expect(() =>
      resolveTransportConfig(
        {
          NODE_ENV: "development",
          SSHELF_TRANSPORT: "local",
          SSHELF_LOCAL_ROOT: process.cwd(),
        },
        { ...DEVELOPMENT_RUNTIME, isProduction: true }
      )
    ).toThrow(/restricted to an explicit development runtime/)
  })

  it("rejects local transport unless NODE_ENV is development", () => {
    expect(() =>
      resolveTransportConfig(
        {
          NODE_ENV: "test",
          SSHELF_TRANSPORT: "local",
          SSHELF_LOCAL_ROOT: process.cwd(),
        },
        DEVELOPMENT_RUNTIME
      )
    ).toThrow(/restricted to an explicit development runtime/)
  })

  it("requires a dedicated, absolute, non-root local directory", () => {
    expect(() =>
      resolveTransportConfig(
        { NODE_ENV: "development", SSHELF_TRANSPORT: "local" },
        DEVELOPMENT_RUNTIME
      )
    ).toThrow(/SSHELF_LOCAL_ROOT is required/)
    expect(() =>
      resolveTransportConfig(
        {
          NODE_ENV: "development",
          SSHELF_TRANSPORT: "local",
          SSHELF_LOCAL_ROOT: "relative",
        },
        DEVELOPMENT_RUNTIME
      )
    ).toThrow(/must be an absolute path/)
    expect(() =>
      resolveTransportConfig(
        {
          NODE_ENV: "development",
          SSHELF_TRANSPORT: "local",
          SSHELF_LOCAL_ROOT: "/",
        },
        DEVELOPMENT_RUNTIME
      )
    ).toThrow(/cannot be the filesystem root/)
  })
})

describe("resolveTransportPath", () => {
  it("keeps SSH paths under their POSIX root", () => {
    const config: TransportConfig = { mode: "ssh", root: "/srv/workspace" }
    expect(resolveTransportPath("a/file.md", config)).toBe(
      "/srv/workspace/a/file.md"
    )
    expect(() => resolveTransportPath("../secret", config)).toThrow(
      /Invalid path/
    )
  })

  it("rejects symlinks anywhere in a local path", () => {
    const root = mkdtempSync(join(tmpdir(), "sshelf-local-path-"))
    const outside = mkdtempSync(join(tmpdir(), "sshelf-outside-"))
    mkdirSync(join(root, "safe"))
    symlinkSync(outside, join(root, "safe", "escape"))
    const config: TransportConfig = { mode: "local", root }

    expect(resolveTransportPath("safe/new.md", config)).toBe(
      join(root, "safe", "new.md")
    )
    expect(resolveTransportPath("missing/nested/new.md", config)).toBe(
      join(root, "missing", "nested", "new.md")
    )
    expect(() =>
      resolveTransportPath("safe/escape/secret.txt", config)
    ).toThrow(/Invalid path/)
  })
})
