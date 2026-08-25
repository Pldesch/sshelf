import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

const REFRESH_DEBOUNCE_MS = 150

export function useRemoteFileEvents() {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (typeof EventSource === "undefined") return

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const events = new EventSource("/api/events")

    function refreshExplorer() {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        // The server only emits this fallback event for an out-of-band change;
        // writes made by this app are consumed server-side. Mark cached remote
        // data stale, but refetch only queries currently visible (the open page
        // and expanded sidebar folders). Route loaders and unrelated status
        // queries stay untouched.
        void queryClient.invalidateQueries({
          predicate: (query) =>
            ["tree", "browse", "search", "db"].includes(
              String(query.queryKey[0])
            ),
          refetchType: "active",
        })
      }, REFRESH_DEBOUNCE_MS)
    }

    events.addEventListener("files-changed", refreshExplorer)

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      events.removeEventListener("files-changed", refreshExplorer)
      events.close()
    }
  }, [queryClient])
}
