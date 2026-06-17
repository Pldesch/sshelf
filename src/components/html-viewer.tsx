import * as React from "react"
import { CodeIcon, EyeIcon } from "lucide-react"
import TextViewer from "@/components/text-viewer"
import { Button } from "@/components/ui/button"
import { rawFileUrl } from "@/lib/file-kinds"

type Mode = "preview" | "source"

// Renders an HTML file as a live page (sandboxed iframe) with a toggle back to
// the syntax-highlighted source. The iframe loads /api/raw, which already
// serves the file with a text/html content type, so the browser renders it.
export default function HtmlViewer({
  path,
  content,
}: {
  path: string
  content: string | null
}) {
  const [mode, setMode] = React.useState<Mode>("preview")
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 self-end rounded-lg bg-muted p-1">
        <ModeButton
          active={mode === "preview"}
          onClick={() => setMode("preview")}
        >
          <EyeIcon data-icon="inline-start" />
          Preview
        </ModeButton>
        <ModeButton
          active={mode === "source"}
          onClick={() => setMode("source")}
        >
          <CodeIcon data-icon="inline-start" />
          Source
        </ModeButton>
      </div>
      {mode === "preview" ? (
        <iframe
          src={rawFileUrl(path)}
          title={path}
          // allow-scripts (without allow-same-origin) runs the page's own JS in
          // an opaque origin, so it can't touch the explorer it's embedded in.
          sandbox="allow-scripts allow-popups allow-forms"
          className="h-[78vh] w-full rounded-lg bg-white shadow-sm"
        />
      ) : content !== null ? (
        <TextViewer path={path} content={content} />
      ) : (
        <p className="text-sm text-muted-foreground">
          The source is too large to display. Switch to Preview, or download the
          file to read it on your computer.
        </p>
      )}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "ghost"}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
