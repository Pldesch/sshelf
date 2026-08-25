import { queryOptions } from "@tanstack/react-query"
import {
  browsePath,
  getSshHosts,
  getTree,
  listDirectories,
  searchFiles,
} from "@/server/files"
import {
  listDatabaseTables,
  readDatabaseTable,
  readDatabaseView,
  readRowBody,
} from "@/server/database"
import { getCyrusOverview } from "@/server/cyrus"

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
 *   ["cyrus", "overview"]                     – Cyrus service/session/worktree status
 *
 * A broad `["browse"]` or `["db", "table", path]` invalidation matches every
 * more-specific key beneath it, which is how file/row mutations refresh.
 */

export function treeQueryOptions() {
  return queryOptions({
    queryKey: ["tree"] as const,
    queryFn: () => getTree(),
    // EventSource handles normal changes. This slow poll is only a consistency
    // fallback after a dropped event/reconnect.
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
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
    gcTime: 60_000,
  })
}

export function directoriesQueryOptions() {
  return queryOptions({
    queryKey: ["directories"] as const,
    queryFn: () => listDirectories(),
    staleTime: 30_000,
  })
}

export function dbTablesQueryOptions(path: string) {
  return queryOptions({
    queryKey: ["db", "tables", path] as const,
    queryFn: () => listDatabaseTables({ data: { path } }),
  })
}

export function dbTableQueryOptions(path: string, table: string, offset = 0) {
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

export function cyrusOverviewQueryOptions() {
  return queryOptions({
    queryKey: ["cyrus", "overview"] as const,
    queryFn: () => getCyrusOverview(),
    // Always stale: the app-wide default (refetchOnWindowFocus: true) then
    // means switching back to this tab always re-checks status, not just
    // when the last fetch happens to be older than some threshold. The
    // 15s poll covers staying on the tab; the server still holds its own
    // result for 10s, so neither this nor a focus flick floods SSH.
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
}
