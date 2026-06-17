#!/usr/bin/env node
/**
 * dbcli — a tiny CLI for reading and editing the SQLite databases used by
 * Codex Explorer (or any SQLite file), local or over SSH.
 *
 * It shells out to the `sqlite3` CLI in JSON mode, mirroring how the app's
 * server layer works, so agents operate on the exact same files the UI shows.
 *
 *   node scripts/dbcli.mjs discover <db>
 *   node scripts/dbcli.mjs read <db> <table> [--where SQL] [--limit N] [--columns a,b]
 *   node scripts/dbcli.mjs insert <db> <table> '<json-object>'
 *   node scripts/dbcli.mjs update <db> <table> '<json-object>' --where SQL
 *   node scripts/dbcli.mjs delete <db> <table> --where SQL
 *   node scripts/dbcli.mjs sql <db> "<SQL>" [--write]
 *
 * Target selection (where the db file lives):
 *   default     use the host saved in ~/.codex-explorer.json; relative paths
 *               resolve under the remote root (same as the app), which
 *               defaults to /home/ubuntu and is overridable via
 *               EXPLORER_REMOTE_ROOT
 *   --host X    SSH to host alias X
 *   --local     run against the local filesystem (path relative to cwd)
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const REMOTE_ROOT = process.env.EXPLORER_REMOTE_ROOT || "/home/ubuntu"
const CONFIG_FILE = join(homedir(), ".codex-explorer.json")

function fail(message) {
  process.stderr.write(`dbcli: ${message}\n`)
  process.exit(1)
}

function out(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}

// ── arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      // boolean flags
      if (key === "local" || key === "write") {
        flags[key] = true
      } else {
        flags[key] = argv[++i]
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

// ── quoting (injection-safe) ──────────────────────────────────────────────
const quoteIdent = (name) => '"' + String(name).replace(/"/g, '""') + '"'

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "1" : "0"
  return "'" + String(value).replace(/'/g, "''") + "'"
}

// single-quote for the *remote shell*
const shQuote = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'"

// ── target / transport ────────────────────────────────────────────────────
function resolveTarget(flags) {
  if (flags.local) return { local: true }
  const host = flags.host || readSavedHost()
  if (!host) {
    fail(
      "no SSH host. Pass --host <alias>, or --local for a local file, " +
        "or configure one in ~/.codex-explorer.json"
    )
  }
  return { local: false, host }
}

function readSavedHost() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")).sshHost ?? null
  } catch {
    return null
  }
}

function resolveDbPath(target, dbPath) {
  if (target.local) return dbPath
  if (dbPath.startsWith("/")) return dbPath
  return `${REMOTE_ROOT}/${dbPath.replace(/^\.?\//, "")}`
}

/**
 * Run a sqlite3 command and return its raw stdout. With `soft: true`, returns
 * null on error instead of exiting — used for optional reads (e.g. probing a
 * metadata table that may not exist).
 */
function runSqlite(target, dbPath, sql, { readonly, soft }) {
  const args = ["-cmd", ".timeout 5000"]
  if (readonly) args.unshift("-readonly")
  const sqliteArgs = ["-json", ...args, dbPath, sql]
  try {
    // Capture stderr (don't inherit it) so soft-probe errors stay quiet.
    const opts = {
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }
    if (target.local) {
      return execFileSync("sqlite3", sqliteArgs, opts)
    }
    // Build one remote command string; quote db + sql for the remote shell.
    const remote =
      "sqlite3 -json " +
      (readonly ? "-readonly " : "") +
      `-cmd ${shQuote(".timeout 5000")} ${shQuote(dbPath)} ${shQuote(sql)}`
    return execFileSync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", target.host, remote],
      opts
    )
  } catch (error) {
    if (soft) return null
    const stderr = error.stderr ? String(error.stderr).trim() : ""
    fail(stderr || error.message || "sqlite3 failed")
  }
}

/** Run a read query, returning parsed rows. */
function query(target, dbPath, sql) {
  const raw = runSqlite(target, dbPath, sql, { readonly: true }).trim()
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    fail("could not parse sqlite output (is this a SQLite database?)")
  }
}

/** Like query, but returns null instead of failing (for optional reads). */
function querySoft(target, dbPath, sql) {
  const raw = runSqlite(target, dbPath, sql, { readonly: true, soft: true })
  if (raw == null) return null
  try {
    return JSON.parse(raw.trim() || "[]")
  } catch {
    return null
  }
}

/** Run a writing statement. */
function exec(target, dbPath, sql) {
  runSqlite(target, dbPath, sql, { readonly: false })
}

/** Run a writing statement that returns rows (e.g. via RETURNING). */
function execReturning(target, dbPath, sql) {
  const raw = runSqlite(target, dbPath, sql, { readonly: false }).trim()
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

// ── commands ────────────────────────────────────────────────────────────
function listTables(target, dbPath) {
  return query(
    target,
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' " +
      "AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
    .map((r) => r.name)
    .filter((n) => !String(n).startsWith("_codex_"))
}

function readColumnMeta(target, dbPath, table) {
  // Soft read: a plain SQLite file has no _codex_columns table.
  const rows = querySoft(
    target,
    dbPath,
    `SELECT col, kind, options FROM "_codex_columns" WHERE tbl=${sqlLiteral(table)}`
  )
  if (!rows) return {}
  const meta = {}
  for (const r of rows) {
    let options = []
    try {
      options = r.options ? JSON.parse(r.options) : []
    } catch {
      options = []
    }
    meta[r.col] = { kind: r.kind, options }
  }
  return meta
}

function cmdDiscover(target, dbPath) {
  const tables = listTables(target, dbPath)
  const result = tables.map((table) => {
    const info = query(
      target,
      dbPath,
      `PRAGMA table_info(${quoteIdent(table)})`
    )
    const meta = readColumnMeta(target, dbPath, table)
    const count = query(
      target,
      dbPath,
      `SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`
    )
    return {
      table,
      rowCount: Number(count[0]?.n ?? 0),
      columns: info.map((c) => ({
        name: c.name,
        sqliteType: c.type || null,
        notNull: c.notnull === 1,
        primaryKey: c.pk > 0,
        kind: meta[c.name]?.kind ?? "text",
        options: meta[c.name]?.options ?? [],
      })),
    }
  })
  out({
    database: dbPath,
    tables: result,
    notes: [
      "kind is the Notion-style type; 'text' when untyped.",
      'multi_select values are stored as a comma+space joined string, e.g. "A, B".',
      "select/status values must be one of the option names.",
      "checkbox values are stored as 1 (checked) or 0.",
      "Hidden tables _codex_columns (types), _codex_pages (row markdown bodies), and _codex_views (saved views) are not listed.",
    ],
  })
}

function buildWhere(flags) {
  return flags.where ? ` WHERE ${flags.where}` : ""
}

function cmdRead(target, dbPath, table, flags) {
  const cols = flags.columns
    ? flags.columns
        .split(",")
        .map((c) => quoteIdent(c.trim()))
        .join(", ")
    : "*"
  const limit = flags.limit
    ? ` LIMIT ${Math.max(0, parseInt(flags.limit, 10))}`
    : ""
  const sql =
    `SELECT rowid AS _rowid, ${cols} FROM ${quoteIdent(table)}` +
    buildWhere(flags) +
    limit
  out(query(target, dbPath, sql))
}

function parseJsonArg(raw) {
  if (!raw) fail("expected a JSON object argument")
  try {
    const obj = JSON.parse(raw)
    if (typeof obj !== "object" || Array.isArray(obj) || obj === null) {
      fail("JSON argument must be an object of column → value")
    }
    return obj
  } catch (e) {
    fail(`invalid JSON: ${e.message}`)
  }
}

function cmdInsert(target, dbPath, table, jsonArg) {
  const data = parseJsonArg(jsonArg)
  const keys = Object.keys(data)
  if (keys.length === 0) fail("insert needs at least one column")
  const cols = keys.map(quoteIdent).join(", ")
  const vals = keys.map((k) => sqlLiteral(data[k])).join(", ")
  // RETURNING runs in the same connection as the INSERT, so the rowid is real.
  // For an INTEGER PRIMARY KEY table the key comes back as that column's name,
  // so read the first returned value rather than assuming "rowid".
  const returned = execReturning(
    target,
    dbPath,
    `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals}) RETURNING rowid`
  )
  const rowid = returned[0] ? Number(Object.values(returned[0])[0]) : null
  out({ ok: true, inserted: 1, rowid })
}

function cmdUpdate(target, dbPath, table, jsonArg, flags) {
  if (!flags.where)
    fail("update requires --where (refusing a full-table update)")
  const data = parseJsonArg(jsonArg)
  const keys = Object.keys(data)
  if (keys.length === 0) fail("update needs at least one column to set")
  const setClause = keys
    .map((k) => `${quoteIdent(k)} = ${sqlLiteral(data[k])}`)
    .join(", ")
  exec(
    target,
    dbPath,
    `UPDATE ${quoteIdent(table)} SET ${setClause} WHERE ${flags.where}`
  )
  out({ ok: true })
}

function cmdDelete(target, dbPath, table, flags) {
  if (!flags.where)
    fail("delete requires --where (refusing a full-table delete)")
  exec(target, dbPath, `DELETE FROM ${quoteIdent(table)} WHERE ${flags.where}`)
  out({ ok: true })
}

function cmdSql(target, dbPath, sql, flags) {
  if (!sql) fail("expected a SQL string")
  if (flags.write) {
    exec(target, dbPath, sql)
    out({ ok: true })
  } else {
    out(query(target, dbPath, sql))
  }
}

// ── main ──────────────────────────────────────────────────────────────────
const { positional, flags } = parseArgs(process.argv.slice(2))
const [command, db, ...rest] = positional

if (!command || command === "help" || flags.help) {
  process.stdout.write(
    "dbcli <discover|read|insert|update|delete|sql> <db> [...]\n" +
      "  see the file header for full usage.\n"
  )
  process.exit(command ? 0 : 1)
}
if (!db) fail(`'${command}' needs a database path`)

const target = resolveTarget(flags)
const dbPath = resolveDbPath(target, db)

switch (command) {
  case "discover":
    cmdDiscover(target, dbPath)
    break
  case "read":
    if (!rest[0]) fail("read needs a table name")
    cmdRead(target, dbPath, rest[0], flags)
    break
  case "insert":
    if (!rest[0]) fail("insert needs a table name")
    cmdInsert(target, dbPath, rest[0], rest[1])
    break
  case "update":
    if (!rest[0]) fail("update needs a table name")
    cmdUpdate(target, dbPath, rest[0], rest[1], flags)
    break
  case "delete":
    if (!rest[0]) fail("delete needs a table name")
    cmdDelete(target, dbPath, rest[0], flags)
    break
  case "sql":
    cmdSql(target, dbPath, rest[0], flags)
    break
  default:
    fail(`unknown command '${command}'`)
}
