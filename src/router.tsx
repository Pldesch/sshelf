import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  // A fresh QueryClient per router instance: one per request on the server
  // (so caches never leak between users) and one for the browser session.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Mirrors the previous loader cache: revisiting a folder/file within
        // 30s is instant, and a failed fetch isn't hammered with retries
        // (the SSH layer already retries once and serves stale data).
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: true,
      },
    },
  })

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },

    scrollRestoration: true,
    defaultPreload: "intent",
    // Loader results stay fresh briefly so revisiting a folder/file is instant.
    defaultStaleTime: 30_000,
    defaultPreloadStaleTime: 30_000,
    defaultGcTime: 5 * 60_000,
  })

  // Dehydrate/hydrate the query cache across the SSR boundary and provide the
  // QueryClient to the whole tree (wraps the router's Wrap component).
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
