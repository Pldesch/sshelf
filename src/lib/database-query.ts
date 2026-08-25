export type DbSortState = {
  column: string
  dir: "asc" | "desc"
} | null

export type DbFilterOp =
  | "contains"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"

export interface DbFilter {
  id: number
  column: string
  op: DbFilterOp
  value: string
}

export interface DatabaseTableQuery {
  search?: string
  filters?: Array<DbFilter>
  sort?: DbSortState
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build clauses only after matching every requested column against SQLite's
 * schema. Values are SQL-quoted and identifiers originate from that validated
 * schema, so user-controlled view settings cannot become executable SQL. */
export function buildDatabaseQueryClauses(
  columnNames: Array<string>,
  query: DatabaseTableQuery
): { where: string; orderBy: string } {
  const allowed = new Set(columnNames)
  const conditions: Array<string> = []
  const filters = query.filters ?? []

  for (const filter of filters) {
    if (!allowed.has(filter.column)) {
      throw new Error(`Column "${filter.column}" was not found`)
    }
    const column = quoteIdentifier(filter.column)
    const text = `COALESCE(CAST(${column} AS TEXT), '')`
    switch (filter.op) {
      case "contains":
        conditions.push(
          `instr(lower(${text}), lower(${quoteString(filter.value)})) > 0`
        )
        break
      case "is":
        conditions.push(`${text} = ${quoteString(filter.value)}`)
        break
      case "is_not":
        conditions.push(`${text} <> ${quoteString(filter.value)}`)
        break
      case "is_empty":
        conditions.push(`(${column} IS NULL OR CAST(${column} AS TEXT) = '')`)
        break
      case "is_not_empty":
        conditions.push(
          `(${column} IS NOT NULL AND CAST(${column} AS TEXT) <> '')`
        )
        break
      default:
        throw new Error("Invalid database filter")
    }
  }

  const search = query.search?.trim()
  if (search && columnNames.length > 0) {
    const literal = quoteString(search)
    conditions.push(
      `(${columnNames
        .map((name) => {
          const column = quoteIdentifier(name)
          return `instr(lower(COALESCE(CAST(${column} AS TEXT), '')), lower(${literal})) > 0`
        })
        .join(" OR ")})`
    )
  }

  let orderBy = ""
  if (query.sort) {
    if (!allowed.has(query.sort.column)) {
      throw new Error(`Column "${query.sort.column}" was not found`)
    }
    const rawDirection: unknown = query.sort.dir
    if (rawDirection !== "asc" && rawDirection !== "desc") {
      throw new Error("Invalid database sort direction")
    }
    const column = quoteIdentifier(query.sort.column)
    const direction = rawDirection.toUpperCase()
    orderBy =
      ` ORDER BY CASE WHEN ${column} IS NULL OR CAST(${column} AS TEXT) = '' ` +
      `THEN 1 ELSE 0 END ASC, ${column} COLLATE NOCASE ${direction}`
  }

  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    orderBy,
  }
}
