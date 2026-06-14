import "@blocknote/mantine/style.css"
import * as React from "react"
import { BlockNoteView } from "@blocknote/mantine"
import { useCreateBlockNote } from "@blocknote/react"
import { CheckIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react"

type SaveStatus = "idle" | "saving" | "saved" | "error"

const AUTOSAVE_DELAY_MS = 800

/**
 * YAML frontmatter is metadata, not prose — BlockNote can't represent it,
 * so we slice it off before editing and re-attach it verbatim on save.
 * Without this, opening a note with frontmatter would silently drop it.
 */
const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?)/

function splitFrontmatter(content: string): {
  frontmatter: string
  body: string
} {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: "", body: content }
  return { frontmatter: match[1], body: content.slice(match[1].length) }
}

/**
 * A Notion-style WYSIWYG editor for a chunk of markdown. Edits are serialized
 * back to markdown and persisted via `onSave` automatically, debounced a moment
 * after typing stops. `onSave` receives the full content (frontmatter included)
 * and should throw to signal a failure. Used for both files and per-row pages.
 */
export default function MarkdownEditor({
  content,
  onSave,
}: {
  content: string
  onSave: (full: string) => Promise<void>
}) {
  const editor = useCreateBlockNote()
  const [ready, setReady] = React.useState(false)
  const [status, setStatus] = React.useState<SaveStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  // Kept in refs so the change handler can read them without re-subscribing.
  const frontmatter = React.useRef("")
  const lastSavedFull = React.useRef(content)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the initial markdown into the editor once it exists.
  React.useEffect(() => {
    let cancelled = false
    const { frontmatter: front, body } = splitFrontmatter(content)
    frontmatter.current = front
    lastSavedFull.current = content
    Promise.resolve(editor.tryParseMarkdownToBlocks(body)).then((blocks) => {
      if (cancelled) return
      editor.replaceBlocks(editor.document, blocks)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
    // Initial content is captured on mount; the parent remounts (via `key`)
    // when the path changes, so we intentionally don't depend on `content`.
  }, [editor])

  const save = React.useCallback(async () => {
    const body = await Promise.resolve(editor.blocksToMarkdownLossy())
    const full = frontmatter.current + body
    if (full === lastSavedFull.current) {
      setStatus("saved")
      return
    }
    setStatus("saving")
    setErrorMessage(null)
    try {
      await onSave(full)
      lastSavedFull.current = full
      setStatus("saved")
    } catch (error) {
      setStatus("error")
      setErrorMessage(error instanceof Error ? error.message : "Save failed")
    }
  }, [editor, onSave])

  // Flush a pending save when the editor unmounts (e.g. the user clicks
  // Done or navigates away) so the last keystroke is never lost.
  React.useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        void save()
      }
    }
  }, [save])

  function handleChange() {
    if (!ready) return
    setStatus("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void save()
    }, AUTOSAVE_DELAY_MS)
  }

  return (
    <div>
      {/* Align the indicator with BlockNote's 54px content gutter (below). */}
      <div className="mb-2 flex h-5 items-center justify-end px-[54px]">
        <SaveIndicator status={status} message={errorMessage} />
      </div>
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={ready}
        onChange={handleChange}
      />
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
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        Saving…
      </span>
    )
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--green-600)]">
        <CheckIcon className="size-3.5" />
        Saved
      </span>
    )
  }
  if (status === "error") {
    return (
      <span
        title={message ?? undefined}
        className="flex items-center gap-1.5 text-xs text-destructive"
      >
        <TriangleAlertIcon className="size-3.5" />
        Couldn’t save
      </span>
    )
  }
  return null
}
