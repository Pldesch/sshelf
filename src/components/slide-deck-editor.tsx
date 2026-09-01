import * as React from "react"
import {
  CheckIcon,
  FileDownIcon,
  LoaderIcon,
  MaximizeIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import revealCss from "reveal.js/reveal.css?raw"
import resetCss from "reveal.js/reset.css?raw"
import revealScript from "../../node_modules/reveal.js/dist/reveal.js?raw"
import { SlideTextOverlay } from "@/components/slide-text-overlay"
import { Button } from "@/components/ui/button"
import { buildSlideSrcDoc } from "@/lib/slide-document"
import { applySlideTextEdit } from "@/lib/slide-editing"
import type {
  SlideTextRect,
  SlideTextVisualStyle,
} from "@/components/slide-text-overlay"

type SaveStatus = "idle" | "saving" | "saved" | "error"
type PdfExportStatus = "idle" | "preparing" | "printing"

interface SlideEditRequest {
  key: string
  html: string
  rect: SlideTextRect
  visualStyle: SlideTextVisualStyle
}

const AUTOSAVE_DELAY_MS = 700
const SLIDE_CHANNEL = "sshelf:slides:v1"

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length <= 500 ? value : fallback
}

function textAlignValue(value: unknown): React.CSSProperties["textAlign"] {
  switch (value) {
    case "center":
    case "end":
    case "justify":
    case "left":
    case "match-parent":
    case "right":
    case "start":
      return value
    default:
      return "left"
  }
}

function parseEditRequest(data: unknown): SlideEditRequest | null {
  if (!data || typeof data !== "object") return null
  const value = data as Record<string, unknown>
  if (
    value.type !== "edit-request" ||
    typeof value.key !== "string" ||
    !/^\d+(?:\.\d+)*$/.test(value.key) ||
    typeof value.html !== "string" ||
    value.html.length > 512_000 ||
    !value.rect ||
    typeof value.rect !== "object" ||
    !value.style ||
    typeof value.style !== "object"
  ) {
    return null
  }

  const rawRect = value.rect as Record<string, unknown>
  const rectValues = [rawRect.x, rawRect.y, rawRect.width, rawRect.height]
  if (
    !rectValues.every((entry) => typeof entry === "number" && isFinite(entry))
  ) {
    return null
  }
  const style = value.style as Record<string, unknown>
  return {
    key: value.key,
    html: value.html,
    rect: {
      x: rawRect.x as number,
      y: rawRect.y as number,
      width: rawRect.width as number,
      height: rawRect.height as number,
    },
    visualStyle: {
      color: stringValue(style.color, "inherit"),
      fontFamily: stringValue(style.fontFamily, "inherit"),
      fontFeatureSettings: stringValue(style.fontFeatureSettings, "normal"),
      fontKerning: stringValue(
        style.fontKerning,
        "auto"
      ) as React.CSSProperties["fontKerning"],
      fontOpticalSizing: stringValue(
        style.fontOpticalSizing,
        "auto"
      ) as React.CSSProperties["fontOpticalSizing"],
      fontSize: stringValue(style.fontSize, "inherit"),
      fontStyle: stringValue(style.fontStyle, "normal"),
      fontStretch: stringValue(style.fontStretch, "normal"),
      fontVariant: stringValue(style.fontVariant, "normal"),
      fontVariationSettings: stringValue(style.fontVariationSettings, "normal"),
      fontWeight: stringValue(style.fontWeight, "400"),
      letterSpacing: stringValue(style.letterSpacing, "normal"),
      lineHeight: stringValue(style.lineHeight, "normal"),
      paddingBottom: stringValue(style.paddingBottom, "0px"),
      paddingLeft: stringValue(style.paddingLeft, "0px"),
      paddingRight: stringValue(style.paddingRight, "0px"),
      paddingTop: stringValue(style.paddingTop, "0px"),
      textAlign: textAlignValue(style.textAlign),
      textDecoration: stringValue(style.textDecoration, "none"),
      textRendering: stringValue(
        style.textRendering,
        "auto"
      ) as React.CSSProperties["textRendering"],
      textTransform: stringValue(style.textTransform, "none"),
      whiteSpace: stringValue(style.whiteSpace, "normal"),
      wordSpacing: stringValue(style.wordSpacing, "normal"),
    },
  }
}

export default function SlideDeckEditor({
  path,
  content,
  onSave,
}: {
  path: string
  content: string
  onSave: (content: string) => Promise<void>
}) {
  const [renderSource, setRenderSource] = React.useState(content)
  const [previewReady, setPreviewReady] = React.useState(false)
  const [editRequest, setEditRequest] = React.useState<SlideEditRequest | null>(
    null
  )
  const [status, setStatus] = React.useState<SaveStatus>("idle")
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [revertDepth, setRevertDepth] = React.useState(0)
  const [activeEditDirty, setActiveEditDirty] = React.useState(false)
  const [previewRevision, setPreviewRevision] = React.useState(0)
  const [pdfDocument, setPdfDocument] = React.useState<string | null>(null)
  const [pdfStatus, setPdfStatus] = React.useState<PdfExportStatus>("idle")
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const pdfIframeRef = React.useRef<HTMLIFrameElement>(null)
  const pathRef = React.useRef(path)
  const sourceRef = React.useRef(content)
  const currentEditRef = React.useRef<SlideEditRequest | null>(null)
  const editStartSourceRef = React.useRef<string | null>(null)
  const revertHistoryRef = React.useRef<Array<string>>([])
  const latestEditHtmlRef = React.useRef("")
  const editDirtyRef = React.useRef(false)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = React.useRef(content)
  const queuedSource = React.useRef<string | null>(null)
  const activeSave = React.useRef<Promise<void> | null>(null)

  React.useEffect(() => {
    const pathChanged = pathRef.current !== path
    if (!pathChanged && content === sourceRef.current) return
    pathRef.current = path
    sourceRef.current = content
    lastSaved.current = content
    currentEditRef.current = null
    editStartSourceRef.current = null
    editDirtyRef.current = false
    revertHistoryRef.current = []
    setEditRequest(null)
    setActiveEditDirty(false)
    setRevertDepth(0)
    setRenderSource(content)
    setPdfDocument(null)
    setPdfStatus("idle")
  }, [content, path])

  const drainSaveQueue = React.useCallback(async () => {
    if (activeSave.current) return activeSave.current
    const operation = (async () => {
      while (queuedSource.current !== null) {
        const next = queuedSource.current
        queuedSource.current = null
        if (next === lastSaved.current) continue
        setStatus("saving")
        setSaveError(null)
        try {
          await onSave(next)
          lastSaved.current = next
        } catch (error) {
          setStatus("error")
          setSaveError(error instanceof Error ? error.message : "Save failed")
          return
        }
      }
      setStatus("saved")
    })().finally(() => {
      activeSave.current = null
      if (queuedSource.current !== null) void drainSaveQueue()
    })
    activeSave.current = operation
    return operation
  }, [onSave])

  const queueSave = React.useCallback(
    (next: string) => {
      queuedSource.current = next
      void drainSaveQueue()
    },
    [drainSaveQueue]
  )

  const scheduleSave = React.useCallback(
    (next: string) => {
      setStatus("saving")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        queueSave(next)
      }, AUTOSAVE_DELAY_MS)
    },
    [queueSave]
  )

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        queueSave(sourceRef.current)
      }
    }
  }, [queueSave])

  const sendToPreview = React.useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { channel: SLIDE_CHANNEL, ...message },
        "*"
      )
    },
    []
  )

  const applyEdit = React.useCallback(
    (key: string, html: string) => {
      try {
        const edited = applySlideTextEdit(sourceRef.current, { key, html })
        sourceRef.current = edited.source
        latestEditHtmlRef.current = edited.html
        editDirtyRef.current = true
        setActiveEditDirty(true)
        scheduleSave(edited.source)
        return edited.html
      } catch (error) {
        setStatus("error")
        setSaveError(
          error instanceof Error
            ? error.message
            : "The text could not be edited"
        )
        return latestEditHtmlRef.current
      }
    },
    [scheduleSave]
  )

  const finishCurrentEdit = React.useCallback(
    (html?: string) => {
      const current = currentEditRef.current
      if (!current) return
      const editStartSource = editStartSourceRef.current
      const finalHtml = editDirtyRef.current
        ? applyEdit(current.key, html ?? latestEditHtmlRef.current)
        : current.html
      sendToPreview({ type: "edit-finish", key: current.key, html: finalHtml })
      if (editDirtyRef.current) {
        if (editStartSource !== null && editStartSource !== sourceRef.current) {
          revertHistoryRef.current.push(editStartSource)
          setRevertDepth(revertHistoryRef.current.length)
        }
        if (saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        queueSave(sourceRef.current)
      }
      currentEditRef.current = null
      editStartSourceRef.current = null
      editDirtyRef.current = false
      setActiveEditDirty(false)
      setEditRequest(null)
    },
    [applyEdit, queueSave, sendToPreview]
  )

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === pdfIframeRef.current?.contentWindow &&
        event.data?.channel === SLIDE_CHANNEL
      ) {
        if (event.data.type === "pdf-ready") {
          setPdfStatus("printing")
          pdfIframeRef.current.contentWindow?.postMessage(
            { channel: SLIDE_CHANNEL, type: "print-pdf" },
            "*"
          )
        } else if (event.data.type === "pdf-finished") {
          setPdfDocument(null)
          setPdfStatus("idle")
        } else if (event.data.type === "pdf-error") {
          setPdfDocument(null)
          setPdfStatus("idle")
          setStatus("error")
          setSaveError(
            typeof event.data.message === "string"
              ? event.data.message
              : "The PDF could not be prepared"
          )
        }
        return
      }
      if (
        event.source !== iframeRef.current?.contentWindow ||
        event.data?.channel !== SLIDE_CHANNEL
      ) {
        return
      }
      if (event.data.type === "ready") {
        setPreviewReady(true)
        return
      }
      if (event.data.type === "edit-dismiss") {
        finishCurrentEdit()
        return
      }
      const request = parseEditRequest(event.data)
      if (!request) return
      finishCurrentEdit()
      currentEditRef.current = request
      editStartSourceRef.current = sourceRef.current
      latestEditHtmlRef.current = request.html
      editDirtyRef.current = false
      setActiveEditDirty(false)
      setEditRequest(request)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [finishCurrentEdit])

  React.useEffect(() => {
    const onFullscreenChange = () => {
      sendToPreview({
        type: "set-editing-enabled",
        enabled: document.fullscreenElement !== iframeRef.current,
      })
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [sendToPreview])

  const rendered = React.useMemo(() => {
    try {
      return {
        html: buildSlideSrcDoc({
          source: renderSource,
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
  }, [path, renderSource])

  React.useEffect(() => setPreviewReady(false), [rendered.html])

  function present() {
    finishCurrentEdit()
    sendToPreview({ type: "set-editing-enabled", enabled: false })
    const request = iframeRef.current?.requestFullscreen()
    if (request) {
      void request.catch(() =>
        sendToPreview({ type: "set-editing-enabled", enabled: true })
      )
    }
  }

  function exportPdf() {
    finishCurrentEdit()
    setPdfStatus("preparing")
    try {
      setPdfDocument(
        buildSlideSrcDoc({
          source: sourceRef.current,
          path,
          resetCss,
          revealCss,
          themeCss: "",
          revealScript,
          mode: "print",
        })
      )
    } catch (error) {
      setPdfStatus("idle")
      setStatus("error")
      setSaveError(
        error instanceof Error ? error.message : "The PDF could not be prepared"
      )
    }
  }

  function revertLastEdit() {
    finishCurrentEdit()
    const previous = revertHistoryRef.current.pop()
    if (previous === undefined) return

    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    sourceRef.current = previous
    currentEditRef.current = null
    editStartSourceRef.current = null
    editDirtyRef.current = false
    setEditRequest(null)
    setActiveEditDirty(false)
    setRevertDepth(revertHistoryRef.current.length)
    setRenderSource(previous)
    setPreviewRevision((revision) => revision + 1)
    queueSave(previous)
  }

  const canRevert = activeEditDirty || revertDepth > 0

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--navy-900)]"
      onPointerDownCapture={(event) => {
        if (
          editRequest &&
          event.target instanceof Element &&
          !event.target.closest("[data-slide-text-editor]")
        ) {
          finishCurrentEdit()
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-3 text-white">
        <div className="flex-1" />
        <SaveIndicator status={status} message={saveError} />
        {canRevert ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={revertLastEdit}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Revert
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pdfStatus !== "idle" || rendered.error !== null}
          onClick={exportPdf}
        >
          {pdfStatus === "idle" ? (
            <FileDownIcon data-icon="inline-start" />
          ) : (
            <LoaderIcon data-icon="inline-start" className="animate-spin" />
          )}
          {pdfStatus === "preparing"
            ? "Preparing PDF…"
            : pdfStatus === "printing"
              ? "Save as PDF…"
              : "Export PDF"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={present}>
          <MaximizeIcon data-icon="inline-start" />
          Present
        </Button>
      </div>

      {pdfDocument ? (
        <iframe
          ref={pdfIframeRef}
          srcDoc={pdfDocument}
          title="PDF export"
          sandbox="allow-scripts allow-modals"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed top-0 left-0 -z-10 h-[720px] w-[1280px] border-0"
        />
      ) : null}

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
          <>
            <iframe
              key={`${path}:${previewRevision}`}
              ref={iframeRef}
              srcDoc={rendered.html}
              title={path}
              sandbox="allow-scripts"
              data-ready={previewReady}
              className="absolute inset-0 size-full border-0 bg-white"
            />
            {editRequest ? (
              <SlideTextOverlay
                key={editRequest.key}
                html={editRequest.html}
                rect={editRequest.rect}
                visualStyle={editRequest.visualStyle}
                onChange={(html) => applyEdit(editRequest.key, html)}
                onFinish={(html) => finishCurrentEdit(html)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function SaveIndicator({
  status,
  message,
}: {
  status: SaveStatus
  message: string | null
}) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-white/65">
        <LoaderIcon className="size-3.5 animate-spin" />
        Saving…
      </span>
    )
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-300">
        <CheckIcon className="size-3.5" />
        Saved
      </span>
    )
  }
  if (status === "error") {
    return (
      <span
        title={message ?? undefined}
        className="flex items-center gap-1.5 text-xs text-red-300"
      >
        <TriangleAlertIcon className="size-3.5" />
        Couldn’t save
      </span>
    )
  }
  return null
}
