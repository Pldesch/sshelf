import { createFileRoute } from "@tanstack/react-router"
import { MeetingView } from "@/components/meeting-view"

export const Route = createFileRoute("/meeting")({
  ssr: false,
  component: MeetingView,
})
