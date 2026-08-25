import { browseQueryOptions } from "@/lib/queries"
import type { QueryClient } from "@tanstack/react-query"

export function refreshDirectoryQueries(
  queryClient: QueryClient,
  ...paths: Array<string>
): void {
  for (const path of new Set(paths)) {
    void queryClient.invalidateQueries({
      queryKey: browseQueryOptions(path).queryKey,
    })
    if (path === "") void queryClient.invalidateQueries({ queryKey: ["tree"] })
  }
  void queryClient.invalidateQueries({ queryKey: ["directories"] })
}

export function forgetBrowsePath(queryClient: QueryClient, path: string): void {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === "browse" &&
      typeof query.queryKey[1] === "string" &&
      (query.queryKey[1] === path || query.queryKey[1].startsWith(`${path}/`)),
  })
}
