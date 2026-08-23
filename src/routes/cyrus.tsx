import { createFileRoute, redirect } from "@tanstack/react-router"
import {
  CyrusError,
  CyrusPending,
  CyrusView,
  cyrusLoader,
} from "@/components/cyrus-view"

function isSetupRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SETUP_REQUIRED")
}

export const Route = createFileRoute("/cyrus")({
  loader: async ({ context }) => {
    try {
      await cyrusLoader(context.queryClient)
    } catch (error) {
      if (isSetupRequired(error)) {
        throw redirect({ to: "/", search: { setup: true } })
      }
      throw error
    }
  },
  pendingComponent: CyrusPending,
  errorComponent: CyrusError,
  component: CyrusView,
})
