import * as React from "react"
import { MaximizeIcon, TriangleAlertIcon } from "lucide-react"
import revealCss from "reveal.js/reveal.css?raw"
import resetCss from "reveal.js/reset.css?raw"
import revealScript from "../../node_modules/reveal.js/dist/reveal.js?raw"
import { Button } from "@/components/ui/button"
import { buildSlideSrcDoc } from "@/lib/slide-document"

export default function SlideDeckEditor({
  path,
  content,
}: {
  path: string
  content: string
}) {
  const [previewReady, setPreviewReady] = React.useState(false)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === iframeRef.current?.contentWindow &&
        event.data?.channel === "sshelf:slides:v1" &&
        event.data?.type === "ready"
      ) {
        setPreviewReady(true)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const rendered = React.useMemo(() => {
    try {
      return {
        html: buildSlideSrcDoc({
          source: content,
          path,
          resetCss,
          revealCss,
          themeCss: "",
          revealScript,
        }),
        error: null,
      }
    } catch (error) {
      return {
        html: "",
        error: error instanceof Error ? error.message : "Invalid slide deck",
      }
    }
  }, [content, path])

  React.useEffect(() => setPreviewReady(false), [rendered.html])

  function present() {
    if (iframeRef.current) void iframeRef.current.requestFullscreen()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--navy-900)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-white">
        <div className="flex-1" />
        <Button type="button" size="sm" variant="secondary" onClick={present}>
          <MaximizeIcon data-icon="inline-start" />
          Present
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {rendered.error ? (
          <div className="flex h-full items-center justify-center p-8 text-white">
            <div className="max-w-lg rounded-xl border border-red-300/30 bg-red-950/40 p-5">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <TriangleAlertIcon className="size-4" />
                This deck cannot be previewed
              </div>
              <p className="text-sm text-red-100">{rendered.error}</p>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={rendered.html}
            title={path}
            sandbox="allow-scripts"
            data-ready={previewReady}
            className="absolute inset-0 size-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  )
}
