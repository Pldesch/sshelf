import { createServerFn } from "@tanstack/react-start"
import {
  SshError,
  resolveRemotePath,
  runRemote,
  shellQuote,
} from "@/server/ssh"

/** Cap rows read in one page so a huge table can't flood the client. */
const PAGE_SIZE = 200

/** Alias used to carry each row's rowid alongside its columns. */
const ROWID_ALIAS = "__codex_rowid"

/** Hidden sidecar table holding Notion-style column types + select options. */
const META_TABLE = "_codex_columns"

/** Hidden sidecar table holding each row's markdown page body. */
const PAGES_TABLE = "_codex_pages"

/** A SQLite cell as `sqlite3 -json` emits it. */
export type DbValue = string | number | boolean | null

/** Notion-style display/edit type layered on top of SQLite's storage type. */
export type DbColumnKind =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "checkbox"
  | "email"
  | "url"
  | "date"

const COLUMN_KINDS: ReadonlyArray<DbColumnKind> = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "checkbox",
  "email",
  "url",
  "date",
]
const VALID_KINDS = new Set<string>(COLUMN_KINDS)

/** A choice for a select / multi-select / status column, with its colour. */
export interface DbOption {
  name: string
  color: string
}

export interface DbColumn {
  name: string
  /** The column's declared SQLite type (may be empty for typeless columns). */
  type: string
  /** How the column is displayed/edited; defaults to "text". */
  kind: DbColumnKind
  /** Choices for select-like kinds (empty otherwise). */
  options: Array<DbOption>
}

export interface DbRow {
  /** The row's SQLite rowid, used to target updates/deletes. */
  rowid: number
  cells: Record<string, DbValue>
}

export interface DbTablePage {
  table: string
  columns: Array<DbColumn>
  rows: Array<DbRow>
  totalRows: number
  /** Offset of the first returned row (for pagination). */
  offset: number
  pageSize: number
  /**
   * Whether rows can be edited. False for tables without a usable rowid
   * (e.g. WITHOUT ROWID tables), which we can't safely target by row.
   */
  editable: boolean
}

/** Double-quote a SQLite identifier, escaping embedded quotes — injection-safe. */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Turn a user-entered value into a SQL literal. Strings are single-quoted
 * with embedded quotes doubled, so a value can never break out of the literal.
 * An empty value becomes NULL (a cleared cell is "unset"). SQLite column
 * affinity coerces a quoted number like '42' into an integer where the column
 * calls for one, so we don't need per-type handling here.
 */
function sqlLiteral(value: string | null): string {
  if (value === null || value === "") return "NULL"
  return "'" + value.replace(/'/g, "''") + "'"
}

// Wait up to 5s for a lock instead of failing immediately, in case another
// writer is mid-write. The `.timeout` dot-command sets it with no output (a
// `PRAGMA busy_timeout` would emit a row and corrupt the JSON we parse).
const BUSY_TIMEOUT = `-cmd ${shellQuote(".timeout 5000")}`

// All sqlite3 invocations run through this chain so this process never starts
// two of them at once — concurrent writers otherwise collide with "database is
// locked". Reads are serialized too, which is fine at this scale.
let dbChain: Promise<unknown> = Promise.resolve()
function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbChain.then(fn, fn)
  dbChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Run a read-only query against a remote SQLite file via the `sqlite3` CLI in
 * JSON mode, and parse the rows. `-readonly` guarantees a query can never
 * mutate the file; the whole SQL string is passed as one shell-quoted argument
 * so its contents can't break out into the shell.
 */
async function queryDb(
  absoluteFile: string,
  sql: string
): Promise<Array<Record<string, DbValue>>> {
  const command = `sqlite3 -readonly -json ${BUSY_TIMEOUT} ${shellQuote(absoluteFile)} ${shellQuote(sql)}`
  const out = (await withDbLock(() => runRemote(command))).trim()
  // sqlite3 prints nothing for an empty result set.
  if (!out) return []
  try {
    return JSON.parse(out) as Array<Record<string, DbValue>>
  } catch {
    throw new SshError("This file is not a readable SQLite database")
  }
}

/** Run a writing statement (no `-readonly`, no JSON output). */
async function execDb(absoluteFile: string, sql: string): Promise<void> {
  const command = `sqlite3 ${BUSY_TIMEOUT} ${shellQuote(absoluteFile)} ${shellQuote(sql)}`
  await withDbLock(() => runRemote(command))
}

async function ensureMetaTable(absoluteFile: string): Promise<void> {
  await execDb(
    absoluteFile,
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(META_TABLE)} ` +
      `(tbl TEXT NOT NULL, col TEXT NOT NULL, kind TEXT NOT NULL, ` +
      `options TEXT, PRIMARY KEY (tbl, col))`
  )
}

interface ColumnMeta {
  kind: DbColumnKind
  options: Array<DbOption>
}

/** Read the column-type metadata for a table (empty map if none stored). */
async function readMeta(
  absoluteFile: string,
  table: string
): Promise<Map<string, ColumnMeta>> {
  const map = new Map<string, ColumnMeta>()
  let rows: Array<Record<string, DbValue>>
  try {
    rows = await queryDb(
      absoluteFile,
      `SELECT col, kind, options FROM ${quoteIdent(META_TABLE)} ` +
        `WHERE tbl = ${sqlLiteral(table)}`
    )
  } catch {
    // The sidecar table doesn't exist yet — everything is plain text.
    return map
  }
  for (const r of rows) {
    const kind = String(r.kind)
    if (!VALID_KINDS.has(kind)) continue
    let options: Array<DbOption> = []
    try {
      if (r.options) options = JSON.parse(String(r.options)) as Array<DbOption>
    } catch {
      options = []
    }
    map.set(String(r.col), { kind: kind as DbColumnKind, options })
  }
  return map
}

async function listTables(absoluteFile: string): Promise<Array<string>> {
  const rows = await queryDb(
    absoluteFile,
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  // Hide our own sidecar tables from the table picker.
  return rows
    .map((r) => String(r.name))
    .filter((name) => !name.startsWith("_codex_"))
}

/** Confirm the table exists (rejects sidecar tables too) and return its columns. */
async function tableColumns(
  absoluteFile: string,
  table: string
): Promise<Array<Record<string, DbValue>>> {
  const tables = await listTables(absoluteFile)
  if (!tables.includes(table)) {
    throw new SshError(`Table "${table}" was not found`)
  }
  return queryDb(absoluteFile, `PRAGMA table_info(${quoteIdent(table)})`)
}

export const listDatabaseTables = createServerFn()
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<Array<string>> => {
    return listTables(resolveRemotePath(data.path))
  })

export const readDatabaseTable = createServerFn()
  .inputValidator(
    (data: { path: string; table?: string; offset?: number }) => data
  )
  .handler(async ({ data }): Promise<DbTablePage> => {
    const file = resolveRemotePath(data.path)
    const tables = await listTables(file)
    // Only ever query a table that actually exists in this database.
    const table =
      data.table && tables.includes(data.table) ? data.table : tables[0]
    if (!table) {
      return {
        table: "",
        columns: [],
        rows: [],
        totalRows: 0,
        offset: 0,
        pageSize: PAGE_SIZE,
        editable: false,
      }
    }

    const ident = quoteIdent(table)
    const info = await queryDb(file, `PRAGMA table_info(${ident})`)
    const meta = await readMeta(file, table)
    const columns: Array<DbColumn> = info.map((c) => {
      const name = String(c.name)
      const m = meta.get(name)
      return {
        name,
        type: String(c.type ?? ""),
        kind: m?.kind ?? "text",
        options: m?.options ?? [],
      }
    })

    const countResult = await queryDb(
      file,
      `SELECT COUNT(*) AS n FROM ${ident}`
    )
    const totalRows = Number(countResult[0]?.n ?? 0)
    const offset = Math.max(0, Math.floor(data.offset ?? 0))

    // Carry each row's rowid so edits can target it. WITHOUT ROWID tables have
    // no rowid — fall back to a read-only listing for those. All rows are
    // returned (no LIMIT); the SSH output buffer guards against extreme sizes.
    let editable = true
    let rawRows: Array<Record<string, DbValue>>
    try {
      rawRows = await queryDb(
        file,
        `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${ident}`
      )
    } catch {
      editable = false
      rawRows = await queryDb(file, `SELECT * FROM ${ident}`)
    }

    const rows: Array<DbRow> = rawRows.map((raw, index) => {
      const { [ROWID_ALIAS]: rid, ...cells } = raw
      return { rowid: editable ? Number(rid) : offset + index, cells }
    })

    return {
      table,
      columns,
      rows,
      totalRows,
      offset,
      pageSize: PAGE_SIZE,
      editable,
    }
  })

export const updateDatabaseCell = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      path: string
      table: string
      rowid: number
      column: string
      value: string | null
    }) => data
  )
  .handler(async ({ data }) => {
    const file = resolveRemotePath(data.path)
    const info = await tableColumns(file, data.table)
    if (!info.some((c) => String(c.name) === data.column)) {
      throw new SshError(`Column "${data.column}" was not found`)
    }
    const rowid = Number(data.rowid)
    if (!Number.isInteger(rowid)) throw new SshError("Invalid row id")
    await execDb(
      file,
      `UPDATE ${quoteIdent(data.table)} SET ${quoteIdent(data.column)} = ` +
        `${sqlLiteral(data.value)} WHERE rowid = ${rowid}`
    )
    return { ok: true }
  })

export const addDatabaseRow = createServerFn({ method: "POST" })
  .inputValidator((data: { path: string; table: string }) => data)
  .handler(async ({ data }) => {
    const file = resolveRemotePath(data.path)
    const info = await tableColumns(file, data.table)
    const ident = quoteIdent(data.table)
    // Columns that must be given a value: NOT NULL, no default, not the
    // integer primary key (which auto-fills). Give them a benign placeholder.
    const required = info.filter(
      (c) =>
        Number(c.notnull) === 1 && c.dflt_value === null && Number(c.pk) === 0
    )
    let sql: string
    if (required.length === 0) {
      sql = `INSERT INTO ${ident} DEFAULT VALUES`
    } else {
      const names = required.map((c) => quoteIdent(String(c.name))).join(", ")
      const values = required
        .map((c) =>
          /INT|REAL|FLOA|DOUB|NUM|DEC/.test(String(c.type).toUpperCase())
            ? "0"
            : "''"
        )
        .join(", ")
      sql = `INSERT INTO ${ident} (${names}) VALUES (${values})`
    }
    await execDb(file, sql)
    return { ok: true }
  })

export const deleteDatabaseRow = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { path: string; table: string; rowid: number }) => data
  )
  .handler(async ({ data }) => {
    const file = resolveRemotePath(data.path)
    await tableColumns(file, data.table) // validates the table exists
    const rowid = Number(data.rowid)
    if (!Number.isInteger(rowid)) throw new SshError("Invalid row id")
    await execDb(
      file,
      `DELETE FROM ${quoteIdent(data.table)} WHERE rowid = ${rowid}`
    )
    // Drop the row's page body too, so a reused rowid can't inherit it.
    try {
      await execDb(
        file,
        `DELETE FROM ${quoteIdent(PAGES_TABLE)} ` +
          `WHERE tbl = ${sqlLiteral(data.table)} AND rowid = ${rowid}`
      )
    } catch {
      // No pages table yet — nothing to clean up.
    }
    return { ok: true }
  })

/** Set a column's Notion-style type (and, optionally, its select options). */
export const setColumnType = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      path: string
      table: string
      column: string
      kind: DbColumnKind
      options?: Array<DbOption>
    }) => data
  )
  .handler(async ({ data }) => {
    if (!VALID_KINDS.has(data.kind)) throw new SshError("Unknown column type")
    const file = resolveRemotePath(data.path)
    const info = await tableColumns(file, data.table)
    if (!info.some((c) => String(c.name) === data.column)) {
      throw new SshError(`Column "${data.column}" was not found`)
    }
    await ensureMetaTable(file)
    const options = JSON.stringify(data.options ?? [])
    await execDb(
      file,
      `INSERT INTO ${quoteIdent(META_TABLE)} (tbl, col, kind, options) VALUES (` +
        `${sqlLiteral(data.table)}, ${sqlLiteral(data.column)}, ` +
        `${sqlLiteral(data.kind)}, ${sqlLiteral(options)}) ` +
        `ON CONFLICT(tbl, col) DO UPDATE SET ` +
        `kind = excluded.kind, options = excluded.options`
    )
    return { ok: true }
  })

/** Append a new option to a select-like column (no-op if it already exists). */
export const addColumnOption = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      path: string
      table: string
      column: string
      name: string
      color?: string
    }) => data
  )
  .handler(
    async ({ data }): Promise<{ ok: true; options: Array<DbOption> }> => {
      const name = data.name.trim()
      if (!name) throw new SshError("Option name cannot be empty")
      const file = resolveRemotePath(data.path)
      await tableColumns(file, data.table) // validates the table exists
      await ensureMetaTable(file)
      const meta = await readMeta(file, data.table)
      const existing = meta.get(data.column)
      const options = existing ? [...existing.options] : []
      if (!options.some((o) => o.name === name)) {
        options.push({ name, color: data.color || "default" })
      }
      const kind = existing?.kind ?? "select"
      await execDb(
        file,
        `INSERT INTO ${quoteIdent(META_TABLE)} (tbl, col, kind, options) VALUES (` +
          `${sqlLiteral(data.table)}, ${sqlLiteral(data.column)}, ` +
          `${sqlLiteral(kind)}, ${sqlLiteral(JSON.stringify(options))}) ` +
          `ON CONFLICT(tbl, col) DO UPDATE SET options = excluded.options`
      )
      return { ok: true, options }
    }
  )

/** Add a new column to a table (optionally with a Notion-style type). */
export const addDatabaseColumn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      path: string
      table: string
      name: string
      kind?: DbColumnKind
    }) => data
  )
  .handler(async ({ data }) => {
    const name = data.name.trim()
    if (!name) throw new SshError("Column name cannot be empty")
    const file = resolveRemotePath(data.path)
    const info = await tableColumns(file, data.table)
    if (info.some((c) => String(c.name) === name)) {
      throw new SshError(`A column named "${name}" already exists`)
    }
    // Stored as TEXT; the Notion-style type lives in the metadata table.
    await execDb(
      file,
      `ALTER TABLE ${quoteIdent(data.table)} ADD COLUMN ${quoteIdent(name)} TEXT`
    )
    if (data.kind && data.kind !== "text" && VALID_KINDS.has(data.kind)) {
      await ensureMetaTable(file)
      await execDb(
        file,
        `INSERT INTO ${quoteIdent(META_TABLE)} (tbl, col, kind, options) VALUES (` +
          `${sqlLiteral(data.table)}, ${sqlLiteral(name)}, ` +
          `${sqlLiteral(data.kind)}, ${sqlLiteral("[]")}) ` +
          `ON CONFLICT(tbl, col) DO UPDATE SET kind = excluded.kind`
      )
    }
    return { ok: true }
  })

/** Drop a column from a table and forget its type metadata. */
export const dropDatabaseColumn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { path: string; table: string; column: string }) => data
  )
  .handler(async ({ data }) => {
    const file = resolveRemotePath(data.path)
    const info = await tableColumns(file, data.table)
    if (!info.some((c) => String(c.name) === data.column)) {
      throw new SshError(`Column "${data.column}" was not found`)
    }
    await execDb(
      file,
      `ALTER TABLE ${quoteIdent(data.table)} DROP COLUMN ${quoteIdent(data.column)}`
    )
    try {
      await execDb(
        file,
        `DELETE FROM ${quoteIdent(META_TABLE)} ` +
          `WHERE tbl=${sqlLiteral(data.table)} AND col=${sqlLiteral(data.column)}`
      )
    } catch {
      // No metadata table — nothing to clean up.
    }
    return { ok: true }
  })

async function ensurePagesTable(absoluteFile: string): Promise<void> {
  await execDb(
    absoluteFile,
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(PAGES_TABLE)} ` +
      `(tbl TEXT NOT NULL, rowid INTEGER NOT NULL, body TEXT, ` +
      `PRIMARY KEY (tbl, rowid))`
  )
}

/** Read a row's markdown page body (empty string if none stored yet). */
export const readRowBody = createServerFn()
  .inputValidator(
    (data: { path: string; table: string; rowid: number }) => data
  )
  .handler(async ({ data }): Promise<{ body: string }> => {
    const file = resolveRemotePath(data.path)
    const rowid = Number(data.rowid)
    if (!Number.isInteger(rowid)) throw new SshError("Invalid row id")
    let rows: Array<Record<string, DbValue>>
    try {
      rows = await queryDb(
        file,
        `SELECT body FROM ${quoteIdent(PAGES_TABLE)} ` +
          `WHERE tbl = ${sqlLiteral(data.table)} AND rowid = ${rowid}`
      )
    } catch {
      return { body: "" } // pages table doesn't exist yet
    }
    const body = rows[0]?.body
    return { body: body == null ? "" : String(body) }
  })

/** Create or replace a row's markdown page body. */
export const saveRowBody = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { path: string; table: string; rowid: number; body: string }) => data
  )
  .handler(async ({ data }) => {
    const file = resolveRemotePath(data.path)
    await tableColumns(file, data.table) // validates the table exists
    const rowid = Number(data.rowid)
    if (!Number.isInteger(rowid)) throw new SshError("Invalid row id")
    await ensurePagesTable(file)
    await execDb(
      file,
      `INSERT INTO ${quoteIdent(PAGES_TABLE)} (tbl, rowid, body) VALUES (` +
        `${sqlLiteral(data.table)}, ${rowid}, ${sqlLiteral(data.body)}) ` +
        `ON CONFLICT(tbl, rowid) DO UPDATE SET body = excluded.body`
    )
    return { ok: true }
  })
