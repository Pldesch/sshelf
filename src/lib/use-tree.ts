import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { treeQueryOptions } from "@/lib/queries"
import type { QueryClient } from "@tanstack/react-query"

export type ConnectionState = "connecting" | "connected" | "offline"

// The browser's single QueryClient, captured so the module-level refreshTree()
// helper can invalidate caches from plain event handlers. Only ever read on the
// client (refreshTree is never called during SSR), so cross-request sharing on
// the server is harmless.
let liveQueryClient: QueryClient | undefined

/**
 * Invalidate everything derived from the remote filesystem (tree, folder
 * listings, file contents, database pages) so the next read refetches. Called
 * after a local mutation or a server-sent "files changed" event; pair it with
 * `router.invalidate()` to re-run the active route's loader.
 */
export function refreshTree() {
  void liveQueryClient?.invalidateQueries()
}

/**
 * One shared view of the remote file tree, backed by a single React Query
 * cache entry: every caller subscribes to the same fetch, it refreshes on
 * window focus and on a slow interval, and stale data (kept by the SSH layer
 * when the connection drops) surfaces as the "offline" state.
 */
export function useTree() {
  const queryClient = useQueryClient()
  React.useEffect(() => {
    liveQueryClient = queryClient
  }, [queryClient])

  const query = useQuery(treeQueryOptions())
  const tree = query.data ?? null

  const state: ConnectionState =
    query.isError || tree?.stale ? "offline" : tree ? "connected" : "connecting"

  const error =
    query.error instanceof Error
      ? query.error.message
      : query.isError
        ? "Connection failed"
        : null

  return {
    tree,
    state,
    error,
    refresh: () => {
      void query.refetch()
    },
  }
}
