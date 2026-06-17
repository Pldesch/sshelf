"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useNavigate } from "@tanstack/react-router"
import { useHotkey } from "@tanstack/react-hotkeys"
import { useQuery } from "@tanstack/react-query"
import { CornerDownLeftIcon, SearchIcon } from "lucide-react"
import { FileTypeIcon } from "@/components/file-icon"
import { Spinner } from "@/components/ui/spinner"
import { searchQueryOptions } from "@/lib/queries"
import { nameOf, parentOf } from "@/lib/file-kinds"
import { cn } from "@/lib/utils"
import type { SearchResult } from "@/server/ssh"

// Wait for typing to settle before hitting the server — every keystroke would
// otherwise fire a fresh `find | grep` over SSH.
const DEBOUNCE_MS = 220
// One- and two-letter queries match almost everything; the grep across the
// whole tree only earns its keep once the query is specific enough.
const MIN_QUERY_LENGTH = 2

/**
 * Quick-open command palette: ⌘P / Ctrl+P opens it, typing streams live
 * name + content matches from across the whole remote tree, and ↑/↓/⏎ pick a
 * result. The trigger doubles as the header search box so the palette is the
 * single way to search.
 */
export function FileSearchDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  // ⌘P on macOS, Ctrl+P elsewhere. `Mod` resolves per platform and
  // preventDefault stops the browser's own print/quick-open binding.
  useHotkey("Mod+P", () => setOpen(true), { preventDefault: true })

  const trimmed = query.trim()

  // Wait for typing to settle before hitting the server — every keystroke
  // would otherwise fire a fresh `find | grep` over SSH.
  const [debounced, setDebounced] = React.useState("")
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [trimmed])

  const enabled = open && debounced.length >= MIN_QUERY_LENGTH
  const search = useQuery({ ...searchQueryOptions(debounced), enabled })
  const results: Array<SearchResult> = enabled ? (search.data ?? []) : []
  // Spinner while waiting for the debounce to catch up or for the fetch itself.
  const loading =
    open &&
    trimmed.length >= MIN_QUERY_LENGTH &&
    (debounced !== trimmed || (enabled && search.isFetching))

  // Reset the highlighted row whenever a new query runs.
  React.useEffect(() => {
    setActiveIndex(0)
  }, [debounced])

  // Start fresh each time the palette opens.
  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setActiveIndex(0)
    }
  }, [open])

  // Keep the highlighted row in view as the user arrows through results.
  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function pick(result: SearchResult | undefined) {
    if (!result) return
    setOpen(false)
    navigate({ to: "/$", params: { _splat: result.path } })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (results.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(results[activeIndex])
    }
  }

  const showEmpty =
    !loading && trimmed.length >= MIN_QUERY_LENGTH && results.length === 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex w-full max-w-64 items-center gap-2 rounded-md bg-card px-3 py-2 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-card/70"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search all files…</span>
          <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
            <Mod />P
          </kbd>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed top-[15%] left-1/2 z-50 flex max-h-[70vh] w-full max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          onOpenAutoFocus={(event) => {
            // Let our input grab focus rather than the first result.
            event.preventDefault()
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Search files
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to search every file on the server by name or contents.
          </DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search all files by name or contents…"
              className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <Spinner className="size-4 text-muted-foreground" />}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {trimmed.length < MIN_QUERY_LENGTH ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Keep typing to search across the whole server.
              </p>
            ) : showEmpty ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No file names or contents match “{trimmed}”.
              </p>
            ) : (
              results.map((result, index) => (
                <ResultRow
                  key={result.path}
                  result={result}
                  query={trimmed}
                  active={index === activeIndex}
                  index={index}
                  onHover={() => setActiveIndex(index)}
                  onSelect={() => pick(result)}
                />
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ResultRow({
  result,
  query,
  active,
  index,
  onHover,
  onSelect,
}: {
  result: SearchResult
  query: string
  active: boolean
  index: number
  onHover: () => void
  onSelect: () => void
}) {
  const name = nameOf(result.path)
  const dir = parentOf(result.path)
  // Content matches lead with a snippet of the surrounding text; name matches
  // show where the file lives instead.
  const secondary =
    result.matchedBy === "content" && result.snippet ? (
      <Highlighted text={result.snippet} query={query} />
    ) : dir ? (
      <span className="font-mono">{dir}</span>
    ) : null
  return (
    <button
      type="button"
      data-index={index}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
        active && "bg-[var(--sand-100)]"
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[var(--navy-500)]">
        <FileTypeIcon name={name} type={result.type} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--navy-700)]">
          {name}
        </span>
        {secondary && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {secondary}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {result.matchedBy === "name" ? "name" : "in text"}
      </span>
      {active && (
        <CornerDownLeftIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}

/** Render `text`, bolding each case-insensitive occurrence of `query`. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.toLowerCase()
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: Array<React.ReactNode> = []
  let i = 0
  let key = 0
  while (i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) {
      parts.push(text.slice(i))
      break
    }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <span key={key++} className="font-semibold text-[var(--navy-700)]">
        {text.slice(idx, idx + q.length)}
      </span>
    )
    i = idx + q.length
  }
  return <>{parts}</>
}

/** ⌘ on macOS, "Ctrl" elsewhere. Resolved on mount to avoid an SSR mismatch. */
function Mod() {
  const [isMac, setIsMac] = React.useState(false)
  React.useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent))
  }, [])
  return <span>{isMac ? "⌘" : "Ctrl "}</span>
}
