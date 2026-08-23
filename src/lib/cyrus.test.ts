import { describe, expect, it } from "vitest"
import { formatAge, parseCyrusOverview, parseGithubSlug } from "./cyrus"

describe("parseCyrusOverview", () => {
  it("parses a service, session, and worktree line", () => {
    const raw = [
      'SERVICE\tactive\tactive\t{"status":"busy"}',
      "SESSION\tPEB-14\t1712345678\tTool: Bash",
      "WORKTREE\tPEB-14\t/home/ubuntu/.cyrus/worktrees/PEB-14\tcyrus/peb-14\t0\t753000000\t/home/ubuntu/.cyrus/repos/peb/.git\thttps://github.com/Pldesch/peb.git\t1",
    ].join("\n")

    const result = parseCyrusOverview(raw)

    expect(result.service).toEqual({
      cyrus: "active",
      ngrok: "active",
      api: '{"status":"busy"}',
    })
    expect(result.sessions).toEqual([
      { issue: "PEB-14", updatedAt: 1712345678000, lastStep: "Tool: Bash" },
    ])
    expect(result.worktrees).toEqual([
      {
        name: "PEB-14",
        path: "/home/ubuntu/.cyrus/worktrees/PEB-14",
        branch: "cyrus/peb-14",
        dirty: 0,
        sizeBytes: 753000000,
        repoPath: "/home/ubuntu/.cyrus/repos/peb",
        origin: "https://github.com/Pldesch/peb.git",
        active: true,
      },
    ])
  })

  it("sorts sessions newest-first and worktrees by name", () => {
    const raw = [
      "SESSION\tPEB-1\t100\tdone",
      "SESSION\tPEB-2\t200\tdone",
      "WORKTREE\tPEB-2\t/w/PEB-2\tb\t0\t1\t/r/.git\t\t0",
      "WORKTREE\tPEB-1\t/w/PEB-1\tb\t0\t1\t/r/.git\t\t0",
    ].join("\n")

    const result = parseCyrusOverview(raw)

    expect(result.sessions.map((s) => s.issue)).toEqual(["PEB-2", "PEB-1"])
    expect(result.worktrees.map((w) => w.name)).toEqual(["PEB-1", "PEB-2"])
  })

  it("ignores blank lines and unknown tags", () => {
    const result = parseCyrusOverview("\nJUNK\tfoo\n\n")
    expect(result.sessions).toEqual([])
    expect(result.worktrees).toEqual([])
  })
})

describe("parseGithubSlug", () => {
  it("parses an https clone URL", () => {
    expect(parseGithubSlug("https://github.com/Pldesch/peb.git")).toBe(
      "Pldesch/peb"
    )
  })

  it("parses an ssh clone URL", () => {
    expect(parseGithubSlug("git@github.com:Pldesch/peb.git")).toBe(
      "Pldesch/peb"
    )
  })

  it("parses a URL without a .git suffix", () => {
    expect(parseGithubSlug("https://github.com/Pldesch/peb")).toBe(
      "Pldesch/peb"
    )
  })

  it("returns null for null or non-GitHub origins", () => {
    expect(parseGithubSlug(null)).toBeNull()
    expect(parseGithubSlug("https://gitlab.com/a/b.git")).toBeNull()
  })
})

describe("formatAge", () => {
  const now = 1_000_000_000

  it("shows 'just now' for sub-minute ages", () => {
    expect(formatAge(now - 10_000, now)).toBe("just now")
  })

  it("shows minutes under an hour", () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m ago")
  })

  it("shows hours under a day", () => {
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h ago")
  })

  it("shows days beyond that", () => {
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d ago")
  })
})
