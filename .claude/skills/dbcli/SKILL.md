---
name: dbcli
description: Read, query, insert, update, delete, and discover the schema of the SQLite databases used by Codex Explorer (or any SQLite file), local or over SSH. Use whenever asked to inspect a database's schema, read or modify rows, or work with a .sqlite/.db file by path — e.g. "what's in crm.sqlite", "add a contact", "mark this row contacted", "show the columns of this database". Always run `discover` first to learn the tables, columns, and Notion-style types before writing.
---

# dbcli

A CLI for reading and editing the SQLite databases that back Codex Explorer.
It shells out to `sqlite3` in JSON mode — locally or over SSH — so you operate
on the exact same files the app shows. Output is JSON on stdout; errors go to
stderr with a non-zero exit.

## Invocation

From the project root:

```bash
node scripts/dbcli.mjs <command> <db> [args] [flags]
```

(`bun scripts/dbcli.mjs …` works too.)

### Where the database lives
- **default** — connects to the SSH host saved in `~/.codex-explorer.json`;
  a relative `<db>` resolves under `/home/ubuntu` (same as the app). So
  `crm.sqlite` means `/home/ubuntu/crm.sqlite` on that host.
- `--host <alias>` — use a specific SSH host from `~/.ssh/config`.
- `--local` — operate on a local file (`<db>` is relative to the cwd).

## Workflow: discover first

**Always start with `discover`** so you know the tables, real column names, and
each column's Notion-style `kind` (which dictates how values must be formatted):

```bash
node scripts/dbcli.mjs discover crm.sqlite
```

Returns, per table: `rowCount` and `columns` with `{ name, sqliteType,
notNull, primaryKey, kind, options }`. The `notes` field documents value
formats. Internal tables (`_codex_columns`, `_codex_pages`, `_codex_views`)
are hidden.

## Reading

```bash
# all columns, capped
node scripts/dbcli.mjs read crm.sqlite people --limit 20

# filter + pick columns (each row includes _rowid for targeting writes)
node scripts/dbcli.mjs read crm.sqlite people \
  --where "language='French' AND contacted='Non'" \
  --columns "name,email,role" --limit 50

# arbitrary read-only query
node scripts/dbcli.mjs sql crm.sqlite "SELECT language, COUNT(*) n FROM people GROUP BY language"
```

## Writing

```bash
# insert a row (JSON object of column → value); prints the new rowid
node scripts/dbcli.mjs insert crm.sqlite people \
  '{"name":"Jane Doe","email":"jane@acme.be","language":"French","contacted":"Non"}'

# update — a --where is REQUIRED (no full-table updates)
node scripts/dbcli.mjs update crm.sqlite people \
  '{"contacted":"Mail envoyé"}' --where "rowid=232"

# delete — a --where is REQUIRED
node scripts/dbcli.mjs delete crm.sqlite people --where "rowid=232"

# escape hatch for any statement (mutations need --write)
node scripts/dbcli.mjs sql crm.sqlite "UPDATE people SET role='CTO' WHERE id=5" --write
```

## Value formats (from each column's `kind`)

- `select` / `status` — exactly one of the column's `options[].name`. Creating
  a value the app doesn't know is allowed, but it won't have a colour until
  added as an option in the UI.
- `multi_select` — a comma+space joined string of option names, e.g.
  `"Assurance, TIC adjacent"`.
- `checkbox` — `1` (checked) or `0`.
- `number` / `text` / `email` / `url` / `date` — a plain string or number;
  an empty value clears the cell (stored as NULL).

## Notes & safety
- Table and column names are quoted; inserted/updated values are escaped, so
  data can't break out of the SQL. `--where` and `sql` are raw SQL you author —
  only pass expressions you constructed, never untrusted input.
- The CLI does not touch row markdown bodies (`_codex_pages`), column types
  (`_codex_columns`), or saved views (`_codex_views`); manage those from the app.
- Prefer `_rowid` (from `read`) or the primary key in `--where` to target a
  single row precisely.
