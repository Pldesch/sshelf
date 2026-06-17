import { queryOptions } from "@tanstack/react-query"
import { browsePath, getSshHosts, getTree, searchFiles } from "@/server/files"
import {
  listDatabaseTables,
  readDatabaseTable,
  readDatabaseView,
  readRowBody,
} from "@/server/database"

/**
 * Central definition of every server read as a React Query option object.
 *
 * Query-key conventions (so mutations know what to invalidate):
 *   ["tree"]                                  – the whole visible file tree
 *   ["browse", path]                          – one folder listing or file view
 *   ["sshHosts"]                              – the SSH host picker
 *   ["search", query]                         – a file search
 *   ["db", "tables", path]                    – table names in a database
 *   ["db", "table", path, table, offset]      – one page of rows
 *   ["db", "rowBody", path, table, rowid]     – a row's markdown page body
 *   ["db", "view", path, table]               – a table's saved view config
 *
 * A broad `["browse"]` or `["db", "table", path]` invalidation matches every
 * more-specific key beneath it, which is how file/row mutations refresh.
 */

export function treeQueryOptions() {
  return queryOptions({
    queryKey: ["tree"] as const,
    queryFn: () => getTree(),
    // The remote tree is cached server-side for 30s; poll a bit slower than
    // that so an out-of-band change still surfaces without us hammering SSH.
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function browseQueryOptions(path: string) {
  return queryOptions({
    queryKey: ["browse", path] as const,
    queryFn: () => browsePath({ data: { path } }),
  })
}

export function sshHostsQueryOptions() {
  return queryOptions({
    queryKey: ["sshHosts"] as const,
    queryFn: () => getSshHosts(),
    staleTime: 0,
  })
}

export function searchQueryOptions(query: string) {
  return queryOptions({
    queryKey: ["search", query] as const,
    queryFn: () => searchFiles({ data: { query } }),
  })
}

export function dbTablesQueryOptions(path: string) {
  return queryOptions({
    queryKey: ["db", "tables", path] as const,
    queryFn: () => listDatabaseTables({ data: { path } }),
  })
}

export function dbTableQueryOptions(
  path: string,
  table: string,
  offset: number
) {
  return queryOptions({
    queryKey: ["db", "table", path, table, offset] as const,
    queryFn: () => readDatabaseTable({ data: { path, table, offset } }),
  })
}

export function rowBodyQueryOptions(
  path: string,
  table: string,
  rowid: number
) {
  return queryOptions({
    queryKey: ["db", "rowBody", path, table, rowid] as const,
    queryFn: () => readRowBody({ data: { path, table, rowid } }),
  })
}

export function dbViewQueryOptions(path: string, table: string) {
  return queryOptions({
    queryKey: ["db", "view", path, table] as const,
    queryFn: () => readDatabaseView({ data: { path, table } }),
  })
}
