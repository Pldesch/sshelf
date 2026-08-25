import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
  useMatches,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ToastProvider } from "@/components/ui/toast"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useRemoteFileEvents } from "@/lib/use-file-events"
import { WorkspaceProvider } from "@/lib/use-tree"

import appCss from "../styles.css?url"
import type { QueryClient } from "@tanstack/react-query"

export interface RouterAppContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Sshelf",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/x-icon",
        href: "/favicon.ico",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  component: RootApplication,
  shellComponent: RootDocument,
})

function RootApplication() {
  const location = useLocation()
  const routeNeedsSetup = useMatches({
    select: (matches) =>
      matches.some(
        (match) =>
          (match.loaderData as { kind?: unknown } | undefined)?.kind === "setup"
      ),
  })
  const setup =
    routeNeedsSetup ||
    new URLSearchParams(location.searchStr).get("setup") === "true"

  // Server selection is intentionally a standalone screen. Every normal app
  // route shares one persistent shell so navigation never remounts the sidebar,
  // its expanded folders, the connection stream, or its resize state.
  return (
    <SidebarProvider>
      <WorkspaceProvider>
        {setup ? <Outlet /> : <PersistentExplorerFrame />}
      </WorkspaceProvider>
    </SidebarProvider>
  )
}

function PersistentExplorerFrame() {
  useRemoteFileEvents()
  return (
    <>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Outlet />
      </SidebarInset>
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
        {/* The @tanstack/devtools-vite plugin strips this element (and its
            imports) from production builds, so devtools render in dev only. */}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
