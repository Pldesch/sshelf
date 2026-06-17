import { createFileRoute } from "@tanstack/react-router"
import {
  ErrorView,
  ExplorerView,
  PendingView,
  explorerLoader,
} from "@/components/explorer"
import type { PageDescriptor } from "@/components/explorer"

export const Route = createFileRoute("/$")({
  loader: async ({ context, params }): Promise<PageDescriptor> => {
    return explorerLoader(context.queryClient, { path: params._splat ?? "" })
  },
  pendingComponent: PendingView,
  errorComponent: ErrorView,
  component: PathPage,
})

function PathPage() {
  const descriptor = Route.useLoaderData()
  return <ExplorerView descriptor={descriptor} />
}
