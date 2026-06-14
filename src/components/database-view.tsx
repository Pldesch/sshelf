import * as React from "react"
import { Popover } from "radix-ui"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  ListFilterIcon,
  Maximize2Icon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import {
  addColumnOption,
  addDatabaseColumn,
  addDatabaseRow,
  deleteDatabaseRow,
  dropDatabaseColumn,
  listDatabaseTables,
  readDatabaseTable,
  readRowBody,
  saveRowBody,
  setColumnType,
  updateDatabaseCell,
} from "@/server/database"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { nameOf } from "@/lib/file-kinds"
import type {
  DbColumn,
  DbColumnKind,
  DbRow,
  DbTablePage,
  DbValue,
} from "@/server/database"

const MarkdownEditor = React.lazy(() => import("@/components/markdown-editor"))

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read the database"
}

/** Notion option colours → soft chip styles built from the design tokens. */
const CHIP_COLORS: Record<string, string> = {
  default: "bg-[var(--stone-100)] text-[var(--navy-700)]",
  gray: "bg-[var(--stone-100)] text-[var(--navy-700)]",
  brown: "bg-[var(--sand-100)] text-[var(--stone-700)]",
  orange: "bg-[var(--orange-100)] text-[var(--orange-700)]",
  yellow: "bg-[var(--orange-100)] text-[var(--orange-600)]",
  green: "bg-[var(--green-100)] text-[var(--green-600)]",
  blue: "bg-[var(--blue-100)] text-[var(--blue-600)]",
  purple: "bg-[var(--navy-100)] text-[var(--navy-700)]",
  pink: "bg-[var(--red-100)] text-[var(--red-600)]",
  red: "bg-[var(--red-100)] text-[var(--red-600)]",
}
function chipClass(color: string): string {
  return CHIP_COLORS[color] ?? CHIP_COLORS.default
}

const KIND_LABELS: Record<DbColumnKind, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  checkbox: "Checkbox",
  email: "Email",
  url: "URL",
  date: "Date",
}
const KIND_ORDER = Object.keys(KIND_LABELS) as Array<DbColumnKind>

function colorOf(col: DbColumn, name: string): string {
  return col.options.find((o) => o.name === name)?.color ?? "default"
}

/** Split a multi-select cell ("A, B") into its values. */
function splitMulti(value: DbValue): Array<string> {
  if (value === null || value === "") return []
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function displayText(value: DbValue): { text: string; muted: boolean } {
  if (value === null) return { text: "NULL", muted: true }
  if (typeof value === "boolean")
    return { text: value ? "true" : "false", muted: false }
  const text = String(value)
  return { text, muted: text === "" }
}

// ── search / filter / sort (all client-side over the loaded rows) ──────────
type SortState = { column: string; dir: "asc" | "desc" } | null

type FilterOp = "contains" | "is" | "is_not" | "is_empty" | "is_not_empty"

interface Filter {
  id: number
  column: string
  op: FilterOp
  value: string
}

const FILTER_OPS: Array<{ op: FilterOp; label: string; needsValue: boolean }> =
  [
    { op: "contains", label: "contains", needsValue: true },
    { op: "is", label: "is", needsValue: true },
    { op: "is_not", label: "is not", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ]

function isEmpty(value: DbValue): boolean {
  return value === null || value === ""
}

function matchFilter(value: DbValue, filter: Filter): boolean {
  const text = isEmpty(value) ? "" : String(value)
  const needle = filter.value.toLowerCase()
  switch (filter.op) {
    case "contains":
      return text.toLowerCase().includes(needle)
    case "is":
      return text === filter.value
    case "is_not":
      return text !== filter.value
    case "is_empty":
      return isEmpty(value)
    case "is_not_empty":
      return !isEmpty(value)
  }
}

function compareCells(a: DbValue, b: DbValue): number {
  const ae = isEmpty(a)
  const be = isEmpty(b)
  if (ae && be) return 0
  if (ae) return 1 // empties sort last
  if (be) return -1
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a).localeCompare(String(b))
}

/** Apply filters, then full-text search, then sort — over already-loaded rows. */
function applyView(
  rows: Array<DbRow>,
  columns: Array<DbColumn>,
  view: { search: string; filters: Array<Filter>; sort: SortState }
): Array<DbRow> {
  let result = rows
  for (const filter of view.filters) {
    result = result.filter((r) => matchFilter(r.cells[filter.column], filter))
  }
  const q = view.search.trim().toLowerCase()
  if (q) {
    result = result.filter((r) =>
      columns.some((c) =>
        String(r.cells[c.name] ?? "")
          .toLowerCase()
          .includes(q)
      )
    )
  }
  if (view.sort) {
    const { column, dir } = view.sort
    const factor = dir === "desc" ? -1 : 1
    result = [...result].sort(
      (a, b) => compareCells(a.cells[column], b.cells[column]) * factor
    )
  }
  return result
}

function Chip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${chipClass(color)}`}
    >
      {name}
    </span>
  )
}

export default function DatabaseView({ path }: { path: string }) {
  const [tables, setTables] = React.useState<Array<string> | null>(null)
  const [active, setActive] = React.useState<string | null>(null)
  const [page, setPage] = React.useState<DbTablePage | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [openRowId, setOpenRowId] = React.useState<number | null>(null)
  const [search, setSearch] = React.useState("")
  const [sort, setSort] = React.useState<SortState>(null)
  const [filters, setFilters] = React.useState<Array<Filter>>([])

  // The view controls reference column names, so reset them per table.
  React.useEffect(() => {
    setSearch("")
    setSort(null)
    setFilters([])
  }, [active])

  React.useEffect(() => {
    let cancelled = false
    setError(null)
    setTables(null)
    setActive(null)
    setPage(null)
    setLoading(true)
    listDatabaseTables({ data: { path } })
      .then((list) => {
        if (cancelled) return
        setTables(list)
        setActive(list[0] ?? null)
        if (list.length === 0) setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const loadTable = React.useCallback(
    async (background = false) => {
      if (!active) return
      if (!background) setLoading(true)
      setError(null)
      try {
        const result = await readDatabaseTable({
          data: { path, table: active },
        })
        setPage(result)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        if (!background) setLoading(false)
      }
    },
    [path, active]
  )

  React.useEffect(() => {
    void loadTable(false)
  }, [loadTable])

  const displayRows = React.useMemo(
    () =>
      page ? applyView(page.rows, page.columns, { search, filters, sort }) : [],
    [page, search, filters, sort]
  )

  async function saveCell(rowid: number, column: string, raw: string) {
    if (!active) return
    const value = raw === "" ? null : raw
    const previous = page
    setPage((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) =>
              r.rowid === rowid
                ? { ...r, cells: { ...r.cells, [column]: value } }
                : r
            ),
          }
        : p
    )
    setMutationError(null)
    try {
      await updateDatabaseCell({
        data: { path, table: active, rowid, column, value },
      })
    } catch (err) {
      setMutationError(errorMessage(err))
      setPage(previous)
    }
  }

  // Add a select option optimistically (keeps the open editor mounted), then
  // persist it. A full reload would close the popover mid-interaction.
  async function createOption(column: string, name: string) {
    if (!active) return
    setPage((p) =>
      p
        ? {
            ...p,
            columns: p.columns.map((c) =>
              c.name === column && !c.options.some((o) => o.name === name)
                ? { ...c, options: [...c.options, { name, color: "default" }] }
                : c
            ),
          }
        : p
    )
    try {
      await addColumnOption({ data: { path, table: active, column, name } })
    } catch (err) {
      setMutationError(errorMessage(err))
    }
  }

  async function runMutation(fn: () => Promise<unknown>) {
    if (!active) return
    setBusy(true)
    setMutationError(null)
    try {
      await fn()
      await loadTable(true)
    } catch (err) {
      setMutationError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Alert variant="destructive" className="bg-card shadow-sm">
        <TriangleAlertIcon />
        <AlertTitle>Could not open this database</AlertTitle>
        <AlertDescription>
          <p className="font-mono text-xs">{error}</p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-[var(--navy-500)]">
          <DatabaseIcon className="size-4" />
        </span>
        <h1 className="truncate text-base font-semibold text-[var(--navy-700)]">
          {nameOf(path)}
        </h1>
        {page && page.columns.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <SearchBar value={search} onChange={setSearch} />
            <SortControl
              columns={page.columns}
              sort={sort}
              onChange={setSort}
            />
            <FilterControl
              columns={page.columns}
              filters={filters}
              onChange={setFilters}
            />
          </div>
        )}
      </div>

      {tables && tables.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {tables.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActive(name)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
                name === active
                  ? "bg-[var(--navy-700)] text-[var(--paper)]"
                  : "bg-card text-[var(--navy-600)] shadow-xs hover:bg-[var(--sand-100)]"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {mutationError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>That change didn’t save</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs">{mutationError}</p>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ) : tables && tables.length === 0 ? (
        <Alert className="bg-card shadow-sm">
          <DatabaseIcon />
          <AlertTitle>No tables</AlertTitle>
          <AlertDescription>
            This database file has no tables to show.
          </AlertDescription>
        </Alert>
      ) : page ? (
        <TableGrid
          page={page}
          rows={displayRows}
          busy={busy}
          onEditCell={saveCell}
          onCreateOption={createOption}
          onOpenRow={setOpenRowId}
          onSetType={(column, kind, options) =>
            runMutation(() =>
              setColumnType({
                data: { path, table: page.table, column, kind, options },
              })
            )
          }
          onDropColumn={(column) =>
            runMutation(() =>
              dropDatabaseColumn({ data: { path, table: page.table, column } })
            )
          }
          onAddColumn={(name, kind) =>
            runMutation(() =>
              addDatabaseColumn({
                data: { path, table: page.table, name, kind },
              })
            )
          }
          onAddRow={() =>
            runMutation(() =>
              addDatabaseRow({ data: { path, table: page.table } })
            )
          }
          onDeleteRow={(rowid) =>
            runMutation(() =>
              deleteDatabaseRow({ data: { path, table: page.table, rowid } })
            )
          }
        />
      ) : null}

      {page && (
        <Sheet
          modal={false}
          open={openRowId !== null}
          onOpenChange={(o) => !o && setOpenRowId(null)}
        >
          {openRowId !== null && (
            <RowPage
              path={path}
              page={page}
              rowid={openRowId}
              onEditCell={saveCell}
              onCreateOption={createOption}
            />
          )}
        </Sheet>
      )}
    </div>
  )
}

function TableGrid({
  page,
  rows,
  busy,
  onEditCell,
  onCreateOption,
  onOpenRow,
  onSetType,
  onDropColumn,
  onAddColumn,
  onAddRow,
  onDeleteRow,
}: {
  page: DbTablePage
  rows: Array<DbRow>
  busy: boolean
  onEditCell: (rowid: number, column: string, value: string) => void
  onCreateOption: (column: string, name: string) => void
  onOpenRow: (rowid: number) => void
  onSetType: (
    column: string,
    kind: DbColumnKind,
    options: DbColumn["options"]
  ) => void
  onDropColumn: (column: string) => void
  onAddColumn: (name: string, kind: DbColumnKind) => void
  onAddRow: () => void
  onDeleteRow: (rowid: number) => void
}) {
  const total = page.totalRows
  const shown = rows.length
  const colSpan = page.columns.length + (page.editable ? 2 : 0)

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--stone-200)]">
              {page.editable && <th className="w-8" />}
              {page.columns.map((col) => (
                <th
                  key={col.name}
                  className="p-0 text-left align-bottom font-semibold whitespace-nowrap text-[var(--navy-700)]"
                >
                  <ColumnHeader
                    col={col}
                    editable={page.editable}
                    onSetType={onSetType}
                    onDropColumn={onDropColumn}
                  />
                </th>
              ))}
              {page.editable && (
                <th className="w-10 px-2 py-2 align-bottom">
                  <AddColumnButton busy={busy} onAddColumn={onAddColumn} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && total > 0 && (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.rowid}
                className="group border-b border-[var(--stone-100)] last:border-0 hover:bg-[var(--sand-100)]"
              >
                {page.editable && (
                  <td className="w-8 py-2 pl-2 align-top">
                    <button
                      type="button"
                      aria-label="Open page"
                      onClick={() => onOpenRow(row.rowid)}
                      className="flex size-7 items-center justify-center rounded-md text-[var(--stone-400)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--sand-100)] hover:text-[var(--navy-600)]"
                    >
                      <Maximize2Icon className="size-3.5" />
                    </button>
                  </td>
                )}
                {page.columns.map((col) => (
                  <td key={col.name} className="max-w-[280px] align-top">
                    <Cell
                      col={col}
                      value={row.cells[col.name]}
                      editable={page.editable}
                      onEdit={(value) => onEditCell(row.rowid, col.name, value)}
                      onCreateOption={(name) => onCreateOption(col.name, name)}
                    />
                  </td>
                ))}
                {page.editable && (
                  <td className="px-2 py-2 align-top whitespace-nowrap">
                    <button
                      type="button"
                      aria-label="Delete row"
                      disabled={busy}
                      onClick={() => onDeleteRow(row.rowid)}
                      className="flex size-7 items-center justify-center rounded-md text-[var(--stone-400)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--red-100)] hover:text-[var(--red-600)] disabled:opacity-50"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--stone-100)] px-4 py-2.5">
        {page.editable ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAddRow}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--navy-600)] transition-colors hover:bg-[var(--sand-100)] disabled:opacity-50"
          >
            <PlusIcon className="size-3.5" />
            New row
          </button>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            read-only
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {total === 0
            ? "No rows"
            : shown === total
              ? `${total} row${total === 1 ? "" : "s"}`
              : `${shown} of ${total} rows`}
        </span>
      </div>
    </div>
  )
}

function ColumnHeader({
  col,
  editable,
  onSetType,
  onDropColumn,
}: {
  col: DbColumn
  editable: boolean
  onSetType: (
    column: string,
    kind: DbColumnKind,
    options: DbColumn["options"]
  ) => void
  onDropColumn: (column: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const label = (
    <>
      {col.name}
      <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
        {KIND_LABELS[col.kind].toLowerCase()}
      </span>
    </>
  )
  if (!editable) {
    return <span className="block px-2 py-2">{label}</span>
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          // Right-click anywhere on the header opens the same menu.
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
          className="flex w-full items-center gap-1 px-2 py-2 transition-colors hover:bg-[var(--sand-100)]"
        >
          {label}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-44 rounded-lg border border-[var(--stone-200)] bg-card p-1 text-sm shadow-lg"
        >
          <p className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Property type
          </p>
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                onSetType(col.name, kind, col.options)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[var(--navy-700)] hover:bg-[var(--sand-100)]"
            >
              {KIND_LABELS[kind]}
              {col.kind === kind && (
                <CheckIcon className="size-3.5 text-[var(--navy-600)]" />
              )}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--stone-200)]" />
          <button
            type="button"
            onClick={() => {
              onDropColumn(col.name)
              setOpen(false)
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[var(--red-600)] hover:bg-[var(--red-100)]"
          >
            <Trash2Icon className="size-3.5" />
            Delete column
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Cell({
  col,
  value,
  editable,
  onEdit,
  onCreateOption,
}: {
  col: DbColumn
  value: DbValue
  editable: boolean
  onEdit: (value: string) => void
  onCreateOption: (name: string) => void
}) {
  if (col.kind === "select" || col.kind === "status") {
    return (
      <SelectCell
        col={col}
        value={value}
        editable={editable}
        onPick={onEdit}
        onCreateOption={onCreateOption}
      />
    )
  }
  if (col.kind === "multi_select") {
    return (
      <MultiSelectCell
        col={col}
        value={value}
        editable={editable}
        onChange={(values) => onEdit(values.join(", "))}
        onCreateOption={onCreateOption}
      />
    )
  }
  if (col.kind === "checkbox") {
    const checked =
      value === 1 || value === "1" || value === true || value === "true"
    return (
      <div className="px-4 py-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={!editable}
          onChange={(e) => onEdit(e.target.checked ? "1" : "0")}
          className="size-4 accent-[var(--navy-600)]"
        />
      </div>
    )
  }
  return <TextCell value={value} editable={editable} onCommit={onEdit} />
}

function TextCell({
  value,
  editable,
  onCommit,
}: {
  value: DbValue
  editable: boolean
  onCommit: (value: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  if (editable && editing) {
    return (
      <div className="px-2 py-1.5">
        <CellEditor
          initial={editText(value)}
          onCommit={(v) => {
            setEditing(false)
            if (v !== editText(value)) onCommit(v)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }
  const { text, muted } = displayText(value)
  return (
    <div
      title={text}
      onClick={editable ? () => setEditing(true) : undefined}
      className={`min-h-[38px] truncate px-4 py-2.5 ${editable ? "cursor-text" : ""} ${
        muted ? "text-muted-foreground italic" : "text-[var(--navy-700)]"
      }`}
    >
      {text}
    </div>
  )
}

function SelectCell({
  col,
  value,
  editable,
  onPick,
  onCreateOption,
}: {
  col: DbColumn
  value: DbValue
  editable: boolean
  onPick: (value: string) => void
  onCreateOption: (name: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const current = value === null ? "" : String(value)
  const trigger = (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1 px-3 py-2">
      {current ? (
        <Chip name={current} color={colorOf(col, current)} />
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  )
  if (!editable) return trigger
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="w-full text-left">{trigger}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-60 rounded-lg border border-[var(--stone-200)] bg-card p-1.5 shadow-lg"
        >
          <OptionList
            col={col}
            selected={current ? [current] : []}
            onToggle={(name) => {
              onPick(name === current ? "" : name)
              setOpen(false)
            }}
            onCreate={(name) => {
              onCreateOption(name)
              onPick(name)
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MultiSelectCell({
  col,
  value,
  editable,
  onChange,
  onCreateOption,
}: {
  col: DbColumn
  value: DbValue
  editable: boolean
  onChange: (values: Array<string>) => void
  onCreateOption: (name: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const values = splitMulti(value)
  const trigger = (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1 px-3 py-2">
      {values.length ? (
        values.map((v) => <Chip key={v} name={v} color={colorOf(col, v)} />)
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  )
  if (!editable) return trigger
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="w-full text-left">{trigger}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-60 rounded-lg border border-[var(--stone-200)] bg-card p-1.5 shadow-lg"
        >
          <OptionList
            col={col}
            selected={values}
            onToggle={(name) =>
              onChange(
                values.includes(name)
                  ? values.filter((v) => v !== name)
                  : [...values, name]
              )
            }
            onCreate={(name) => {
              onCreateOption(name)
              onChange([...values, name])
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function OptionList({
  col,
  selected,
  onToggle,
  onCreate,
}: {
  col: DbColumn
  selected: Array<string>
  onToggle: (name: string) => void
  onCreate: (name: string) => void
}) {
  const [query, setQuery] = React.useState("")
  const q = query.trim()
  const filtered = col.options.filter((o) =>
    o.name.toLowerCase().includes(q.toLowerCase())
  )
  const exists = col.options.some(
    (o) => o.name.toLowerCase() === q.toLowerCase()
  )
  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search or add…"
        className="mb-1.5 w-full rounded-md border border-[var(--stone-200)] bg-white px-2 py-1 text-sm outline-none focus:border-[var(--navy-400)]"
      />
      <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {filtered.map((o) => (
          <button
            key={o.name}
            type="button"
            onClick={() => onToggle(o.name)}
            className="flex w-full items-center justify-between rounded-md px-1.5 py-1 hover:bg-[var(--sand-100)]"
          >
            <Chip name={o.name} color={o.color} />
            {selected.includes(o.name) && (
              <CheckIcon className="size-3.5 text-[var(--navy-600)]" />
            )}
          </button>
        ))}
        {q && !exists && (
          <button
            type="button"
            onClick={() => {
              onCreate(q)
              setQuery("")
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-[var(--navy-700)] hover:bg-[var(--sand-100)]"
          >
            <PlusIcon className="size-3.5" />
            Create “{q}”
          </button>
        )}
        {filtered.length === 0 && !q && (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">
            No options yet — type to add one.
          </p>
        )}
      </div>
    </div>
  )
}

/** The string the editor starts with (NULL edits as an empty field). */
function editText(value: DbValue): string {
  return value === null ? "" : String(value)
}

/**
 * A one-shot inline text editor. Commits exactly once — on Enter or blur —
 * and cancels on Escape, guarding against the Enter-then-blur double fire.
 */
function CellEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = React.useState(initial)
  const done = React.useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(draft)
    else onCancel()
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          finish(true)
        } else if (e.key === "Escape") {
          e.preventDefault()
          finish(false)
        }
      }}
      className="w-full min-w-[120px] rounded-md border border-[var(--navy-300)] bg-white px-2 py-1 text-sm text-[var(--navy-700)] outline-none focus:border-[var(--navy-500)]"
    />
  )
}

function AddColumnButton({
  busy,
  onAddColumn,
}: {
  busy: boolean
  onAddColumn: (name: string, kind: DbColumnKind) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [kind, setKind] = React.useState<DbColumnKind>("text")
  const submit = () => {
    if (!name.trim()) return
    onAddColumn(name.trim(), kind)
    setName("")
    setKind("text")
    setOpen(false)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Add column"
          disabled={busy}
          className="flex size-7 items-center justify-center rounded-md text-[var(--stone-400)] transition-colors hover:bg-[var(--sand-100)] hover:text-[var(--navy-600)] disabled:opacity-50"
        >
          <PlusIcon className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-60 rounded-lg border border-[var(--stone-200)] bg-card p-2 shadow-lg"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Column name"
            className="mb-2 w-full rounded-md border border-[var(--stone-200)] bg-white px-2 py-1 text-sm outline-none focus:border-[var(--navy-400)]"
          />
          <div className="mb-2 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm text-[var(--navy-700)] hover:bg-[var(--sand-100)]"
              >
                {KIND_LABELS[k]}
                {kind === k && (
                  <CheckIcon className="size-3.5 text-[var(--navy-600)]" />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="w-full rounded-md bg-[var(--navy-700)] px-2 py-1.5 text-sm font-medium text-[var(--paper)] transition-colors hover:bg-[var(--navy-600)] disabled:opacity-50"
          >
            Add column
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * A row opened as a Notion-style page: its properties (editable, reusing the
 * same cell widgets) plus a free-form markdown body stored per row.
 */
function RowPage({
  path,
  page,
  rowid,
  onEditCell,
  onCreateOption,
}: {
  path: string
  page: DbTablePage
  rowid: number
  onEditCell: (rowid: number, column: string, value: string) => void
  onCreateOption: (column: string, name: string) => void
}) {
  const row: DbRow | undefined = page.rows.find((r) => r.rowid === rowid)
  // Use a "name"/"title" column as the page heading, else the first
  // non-numeric column, else the first column — anything but a bare id.
  const titleColumn =
    page.columns.find((c) => /^(name|title)$/i.test(c.name)) ??
    page.columns.find(
      (c) => c.kind !== "number" && c.name.toLowerCase() !== "id"
    ) ??
    page.columns[0]
  const title = row ? displayText(row.cells[titleColumn.name]).text : ""
  const [body, setBody] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setBody(null)
    readRowBody({ data: { path, table: page.table, rowid } })
      .then((r) => {
        if (!cancelled) setBody(r.body)
      })
      .catch(() => {
        if (!cancelled) setBody("")
      })
    return () => {
      cancelled = true
    }
  }, [path, page.table, rowid])

  const saveBody = React.useCallback(
    async (full: string) => {
      await saveRowBody({
        data: { path, table: page.table, rowid, body: full },
      })
    },
    [path, page.table, rowid]
  )

  // Drag the left edge to resize the panel.
  const [width, setWidth] = React.useState(560)
  const startResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const onMove = (e: MouseEvent) => {
      const next = window.innerWidth - e.clientX
      setWidth(Math.min(Math.max(next, 360), window.innerWidth - 80))
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
    }
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <SheetContent
      side="right"
      overlay={false}
      style={{ width, maxWidth: "100vw" }}
      className="gap-0 overflow-y-auto p-0"
    >
      <div
        onMouseDown={startResize}
        className="absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[var(--orange-300)]"
      />
      <SheetHeader className="px-6 pt-6 pb-2">
        <SheetTitle className="text-xl text-[var(--navy-700)]">
          {title || "Untitled"}
        </SheetTitle>
      </SheetHeader>
      {row && (
        <div className="flex flex-col gap-0.5 px-6 pb-4">
          {page.columns.map((col) => (
            <div
              key={col.name}
              className="grid grid-cols-[110px_1fr] items-start gap-2"
            >
              <span className="truncate py-2.5 text-xs text-muted-foreground">
                {col.name}
              </span>
              <div className="min-w-0">
                <Cell
                  col={col}
                  value={row.cells[col.name]}
                  editable={page.editable}
                  onEdit={(value) => onEditCell(rowid, col.name, value)}
                  onCreateOption={(name) => onCreateOption(col.name, name)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Give the body a default height so there's room to write and scroll,
          even when the note is short or empty. */}
      <div className="min-h-[70vh] border-t border-[var(--stone-200)] py-5 pb-24">
        {body === null ? (
          <div className="flex flex-col gap-2 px-[54px]">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <React.Suspense
            fallback={
              <div className="px-[54px]">
                <Skeleton className="h-4 w-2/3" />
              </div>
            }
          >
            <MarkdownEditor key={rowid} content={body} onSave={saveBody} />
          </React.Suspense>
        )}
      </div>
    </SheetContent>
  )
}

// ── toolbar: search / sort / filter ───────────────────────────────────────
const toolbarButtonClass = (active: boolean) =>
  `flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-xs transition-colors ${
    active
      ? "bg-[var(--navy-700)] text-[var(--paper)]"
      : "bg-card text-[var(--navy-600)] hover:bg-[var(--sand-100)]"
  }`

const SELECT_CLASS =
  "h-7 min-w-0 rounded-md border border-[var(--stone-200)] bg-white px-1 text-xs text-[var(--navy-700)] outline-none focus:border-[var(--navy-400)]"

function SearchBar({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        className="h-8 w-40 rounded-lg border border-transparent bg-card pr-6 pl-8 text-sm shadow-xs outline-none focus:border-[var(--navy-400)]"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-[var(--navy-600)]"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function SortControl({
  columns,
  sort,
  onChange,
}: {
  columns: Array<DbColumn>
  sort: SortState
  onChange: (sort: SortState) => void
}) {
  const [open, setOpen] = React.useState(false)
  const activeCol = sort ? columns.find((c) => c.name === sort.column) : null
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={toolbarButtonClass(Boolean(sort))}>
          <ArrowUpDownIcon className="size-3.5" />
          {sort && activeCol ? (
            <span className="max-w-28 truncate">
              {activeCol.name} {sort.dir === "asc" ? "↑" : "↓"}
            </span>
          ) : (
            "Sort"
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-52 rounded-lg border border-[var(--stone-200)] bg-card p-1 text-sm shadow-lg"
        >
          <p className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Sort by
          </p>
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {columns.map((c) => {
              const dir = sort && sort.column === c.name ? sort.dir : null
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    if (!dir) onChange({ column: c.name, dir: "asc" })
                    else if (dir === "asc")
                      onChange({ column: c.name, dir: "desc" })
                    else onChange(null)
                  }}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[var(--navy-700)] hover:bg-[var(--sand-100)]"
                >
                  <span className="truncate">{c.name}</span>
                  {dir === "asc" && (
                    <ArrowUpIcon className="size-3.5 text-[var(--navy-600)]" />
                  )}
                  {dir === "desc" && (
                    <ArrowDownIcon className="size-3.5 text-[var(--navy-600)]" />
                  )}
                </button>
              )
            })}
          </div>
          {sort && (
            <>
              <div className="my-1 border-t border-[var(--stone-200)]" />
              <button
                type="button"
                onClick={() => onChange(null)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-[var(--sand-100)]"
              >
                <XIcon className="size-3.5" />
                Clear sort
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function FilterControl({
  columns,
  filters,
  onChange,
}: {
  columns: Array<DbColumn>
  filters: Array<Filter>
  onChange: (filters: Array<Filter>) => void
}) {
  const [open, setOpen] = React.useState(false)
  const nextId = React.useRef(1)
  const update = (id: number, patch: Partial<Filter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={toolbarButtonClass(filters.length > 0)}
        >
          <ListFilterIcon className="size-3.5" />
          {filters.length > 0 ? `Filtered (${filters.length})` : "Filter"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-80 rounded-lg border border-[var(--stone-200)] bg-card p-2 text-sm shadow-lg"
        >
          {filters.length === 0 && (
            <p className="px-1 py-1.5 text-xs text-muted-foreground">
              No filters yet.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {filters.map((f) => {
              const needsValue = FILTER_OPS.find(
                (o) => o.op === f.op
              )?.needsValue
              return (
                <div key={f.id} className="flex items-center gap-1">
                  <select
                    value={f.column}
                    onChange={(e) => update(f.id, { column: e.target.value })}
                    className={`${SELECT_CLASS} max-w-24 flex-1`}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={f.op}
                    onChange={(e) =>
                      update(f.id, { op: e.target.value as FilterOp })
                    }
                    className={SELECT_CLASS}
                  >
                    {FILTER_OPS.map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {needsValue && (
                    <input
                      value={f.value}
                      onChange={(e) => update(f.id, { value: e.target.value })}
                      placeholder="value"
                      className="h-7 min-w-0 flex-1 rounded-md border border-[var(--stone-200)] bg-white px-2 text-xs outline-none focus:border-[var(--navy-400)]"
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Remove filter"
                    onClick={() =>
                      onChange(filters.filter((x) => x.id !== f.id))
                    }
                    className="shrink-0 text-muted-foreground hover:text-[var(--red-600)]"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                onChange([
                  ...filters,
                  {
                    id: nextId.current++,
                    column: columns[0].name,
                    op: "contains",
                    value: "",
                  },
                ])
              }
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--navy-600)] hover:bg-[var(--sand-100)]"
            >
              <PlusIcon className="size-3.5" />
              Add filter
            </button>
            {filters.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-[var(--sand-100)]"
              >
                Clear all
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
