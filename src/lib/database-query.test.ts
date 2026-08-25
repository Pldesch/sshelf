import { describe, expect, it } from "vitest"
import { buildDatabaseQueryClauses } from "./database-query"

describe("buildDatabaseQueryClauses", () => {
  it("returns no clauses for an empty view", () => {
    expect(buildDatabaseQueryClauses(["Name"], {})).toEqual({
      where: "",
      orderBy: "",
    })
  })

  it("builds filters, full-table search, and empty-last sorting", () => {
    const clauses = buildDatabaseQueryClauses(["Name", "Score"], {
      search: "alpha",
      filters: [{ id: 1, column: "Name", op: "contains", value: "team" }],
      sort: { column: "Score", dir: "desc" },
    })
    expect(clauses.where).toContain('CAST("Name" AS TEXT)')
    expect(clauses.where).toContain('CAST("Score" AS TEXT)')
    expect(clauses.where).toContain("lower('alpha')")
    expect(clauses.orderBy).toContain('CASE WHEN "Score" IS NULL')
    expect(clauses.orderBy).toContain('"Score" COLLATE NOCASE DESC')
  })

  it("quotes values so they cannot escape into SQL", () => {
    const clauses = buildDatabaseQueryClauses(["Name"], {
      filters: [
        {
          id: 1,
          column: "Name",
          op: "is",
          value: "x' OR 1=1 --",
        },
      ],
    })
    expect(clauses.where).toContain("'x'' OR 1=1 --'")
    expect(clauses.where).not.toContain("= 'x' OR")
  })

  it("rejects columns not present in the validated schema", () => {
    expect(() =>
      buildDatabaseQueryClauses(["Name"], {
        sort: { column: "Name; DROP TABLE users", dir: "asc" },
      })
    ).toThrow("was not found")
  })
})
