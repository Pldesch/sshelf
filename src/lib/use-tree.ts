import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { treeQueryOptions } from "@/lib/queries"

export type ConnectionState = "connecting" | "connected" | "offline"

/**
 * One shared view of the remote file tree, backed by a single React Query
 * cache entry. EventSource keeps it current, a slow interval provides a
 * consistency fallback, and stale SSH data surfaces as the "offline" state.
 */
function useTreeState() {
  const queryClient = useQueryClient()

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
      void queryClient.invalidateQueries({
        queryKey: treeQueryOptions().queryKey,
      })
    },
  }
}

type WorkspaceContextValue = ReturnType<typeof useTreeState>
const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const value = useTreeState()
  return React.createElement(WorkspaceContext.Provider, { value }, children)
}

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value) {
    throw new Error("useWorkspace must be used within WorkspaceProvider")
  }
  return value
}
