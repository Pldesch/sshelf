import * as React from "react"
import { getTree } from "@/server/files"
import type { TreeResult } from "@/server/files"

export type ConnectionState = "connecting" | "connected" | "offline"

interface TreeStore {
  tree: TreeResult | null
  state: ConnectionState
  error: string | null
}

// One shared snapshot for the whole app — fetched once, refreshed on
// focus or manual retry, never per-folder.
let store: TreeStore = { tree: null, state: "connecting", error: null }
const listeners = new Set<() => void>()
let fetching = false

function notify() {
  for (const listener of listeners) listener()
}

async function refresh() {
  if (fetching) return
  fetching = true
  if (store.state === "offline") {
    store = { ...store, state: "connecting" }
    notify()
  }
  try {
    const tree = await getTree()
    store = {
      tree,
      state: tree.stale ? "offline" : "connected",
      error: null,
    }
  } catch (error) {
    store = {
      ...store,
      state: "offline",
      error: error instanceof Error ? error.message : "Connection failed",
    }
  } finally {
    fetching = false
    notify()
  }
}

/** Force a refetch — used after switching SSH servers. */
export function refreshTree() {
  store = { tree: null, state: "connecting", error: null }
  notify()
  void refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTree() {
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => store,
    () => store
  )

  React.useEffect(() => {
    if (!store.tree) void refresh()
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    const interval = window.setInterval(onFocus, 60_000)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.clearInterval(interval)
    }
  }, [])

  return { ...snapshot, refresh }
}
