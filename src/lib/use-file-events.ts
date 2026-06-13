import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { refreshTree } from "@/lib/use-tree"

const REFRESH_DEBOUNCE_MS = 150

export function useRemoteFileEvents() {
  const router = useRouter()

  React.useEffect(() => {
    if (typeof EventSource === "undefined") return

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const events = new EventSource("/api/events")

    function refreshExplorer() {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTree()
        void router.invalidate()
      }, REFRESH_DEBOUNCE_MS)
    }

    events.addEventListener("files-changed", refreshExplorer)

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      events.removeEventListener("files-changed", refreshExplorer)
      events.close()
    }
  }, [router])
}
