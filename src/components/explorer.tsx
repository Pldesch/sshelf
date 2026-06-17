import * as React from "react"
import { Link, useRouter } from "@tanstack/react-router"
import {
  ChevronRightIcon,
  DownloadIcon,
  HouseIcon,
  SearchIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { FileSearchDialog } from "@/components/file-search-dialog"
import { EntryContextMenu } from "@/components/entry-context-menu"
import { FileTypeIcon } from "@/components/file-icon"
import { SetupScreen } from "@/components/setup-screen"
import { ImageViewer, PdfViewer, UnsupportedViewer } from "@/components/viewers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { saveFile } from "@/server/files"
import {
  browseQueryOptions,
  searchQueryOptions,
  sshHostsQueryOptions,
} from "@/lib/queries"
import {
  fileKindOf,
  formatBytes,
  formatDate,
  nameOf,
  parentOf,
  rawFileUrl,
} from "@/lib/file-kinds"
import { useRemoteFileEvents } from "@/lib/use-file-events"
import { useTree } from "@/lib/use-tree"
import type { QueryClient } from "@tanstack/react-query"
import type { BrowseResult, FileView as FileData } from "@/server/files"
import type { RemoteEntry, SearchResult } from "@/server/ssh"

// Heavy renderers (react-markdown, highlight.js) load in their own chunk
// so plain folder browsing never pays for them.
const MarkdownViewer = React.lazy(() => import("@/components/markdown-viewer"))
const TextViewer = React.lazy(() => import("@/components/text-viewer"))
const MarkdownEditor = React.lazy(() => import("@/components/markdown-editor"))
const DatabaseView = React.lazy(() => import("@/components/database-view"))
const HtmlViewer = React.lazy(() => import("@/components/html-viewer"))

/** Which page to render; the data itself lives in the query cache. */
export type PageDescriptor =
  | { kind: "setup" }
  | { kind: "search"; query: string }
  | { kind: "browse"; path: string }

function isSetupRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SETUP_REQUIRED")
}

/**
 * Prefetch the data the page needs into the query cache and return a small
 * descriptor telling the component which query to read. Keeping the data in
 * the cache (rather than returning it from the loader) lets components stay
 * reactive to background refetches and invalidation while still getting an
 * SSR-warmed, preloaded first paint.
 */
export async function explorerLoader(
  queryClient: QueryClient,
  options: { path: string; q?: string; setup?: boolean }
): Promise<PageDescriptor> {
  if (options.setup) {
    await queryClient.ensureQueryData(sshHostsQueryOptions())
    return { kind: "setup" }
  }
  try {
    if (options.q) {
      await queryClient.ensureQueryData(searchQueryOptions(options.q))
      return { kind: "search", query: options.q }
    }
    await queryClient.ensureQueryData(browseQueryOptions(options.path))
    return { kind: "browse", path: options.path }
  } catch (error) {
    // No server chosen yet — first-time use goes to the picker.
    if (isSetupRequired(error)) {
      await queryClient.ensureQueryData(sshHostsQueryOptions())
      return { kind: "setup" }
    }
    throw error
  }
}

export function ExplorerView({ descriptor }: { descriptor: PageDescriptor }) {
  if (descriptor.kind === "setup") return <SetupView />
  if (descriptor.kind === "search")
    return <SearchView query={descriptor.query} />
  return <BrowseView path={descriptor.path} />
}

function SetupView() {
  const { data } = useSuspenseQuery(sshHostsQueryOptions())
  return <SetupScreen hosts={data.hosts} current={data.current} />
}

function SearchView({ query }: { query: string }) {
  const { data } = useSuspenseQuery(searchQueryOptions(query))
  return (
    <ExplorerShell activePath="" currentQuery={query} file={null}>
      <SearchResults query={query} results={data} />
    </ExplorerShell>
  )
}

function BrowseView({ path }: { path: string }) {
  const { data } = useSuspenseQuery(browseQueryOptions(path))
  const file = data.kind === "file" ? data : null
  return (
    <ExplorerShell activePath={path} file={file}>
      {data.stale && (
        <Alert className="mb-5 bg-card shadow-sm">
          <WifiOffIcon />
          <AlertTitle>The server is unreachable right now</AlertTitle>
          <AlertDescription>
            You are looking at the last saved copy. It will refresh
            automatically once the connection is back.
          </AlertDescription>
        </Alert>
      )}
      {data.kind === "dir" ? (
        <DirectoryView path={data.path} entries={data.entries} />
      ) : (
        <FileView data={data} />
      )}
    </ExplorerShell>
  )
}

function ExplorerShell({
  activePath,
  currentQuery,
  file,
  children,
}: {
  activePath: string
  currentQuery?: string
  file: FileData | null
  children: React.ReactNode
}) {
  useRemoteFileEvents()
  const { tree } = useTree()
  const root = tree?.root ?? ""
  // Databases use the full width; prose (markdown/text) keeps a readable column.
  const fullWidth = file ? fileKindOf(nameOf(file.path)) === "database" : false
  return (
    <SidebarProvider>
      <AppSidebar activePath={activePath} />
      <SidebarInset className="min-w-0">
        {/* min-w-0 lets the inset stay at viewport width so wide tables
            scroll inside their own container instead of stretching the page. */}
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/85 px-5 py-3 backdrop-blur-md">
          <SidebarTrigger />
          <PathBreadcrumb path={activePath} isSearch={Boolean(currentQuery)} />
          <div className="flex-1" />
          <FileSearchDialog />
          {file && (
            <>
              <span
                title={root ? `${root}/${file.path}` : file.path}
                className="hidden font-mono text-[11px] whitespace-nowrap text-muted-foreground sm:inline"
              >
                {formatBytes(file.size)} · {formatDate(file.modifiedAt)}
              </span>
              <Button variant="secondary" size="sm" asChild>
                <a href={rawFileUrl(file.path, true)}>
                  <DownloadIcon data-icon="inline-start" />
                  Download
                </a>
              </Button>
            </>
          )}
        </header>
        <div
          className={`mx-auto w-full min-w-0 px-8 pt-3 pb-12 ${fullWidth ? "" : "max-w-[960px]"}`}
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function PathBreadcrumb({
  path,
  isSearch,
}: {
  path: string
  isSearch: boolean
}) {
  const segments = path ? path.split("/") : []
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/" aria-label="All files">
              <HouseIcon className="size-4" />
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {isSearch ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Search</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          segments.map((segment, index) => {
            const segmentPath = segments.slice(0, index + 1).join("/")
            const isLast = index === segments.length - 1
            return (
              <React.Fragment key={segmentPath}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  {isLast ? (
                    <BreadcrumbPage className="truncate">
                      {segment}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        to="/$"
                        params={{ _splat: segmentPath }}
                        className="truncate"
                      >
                        {segment}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            )
          })
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function CompactHeading({
  title,
  fullPath,
  meta,
}: {
  title: string
  fullPath: string
  meta: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h1
        title={fullPath}
        className="truncate text-base font-semibold text-[var(--navy-700)]"
      >
        {title}
      </h1>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {meta}
      </span>
    </div>
  )
}

function DirectoryView({
  path,
  entries,
}: {
  path: string
  entries: Array<RemoteEntry>
}) {
  const { tree } = useTree()
  const root = tree?.root ?? ""
  const folderCount = entries.filter((e) => e.type === "dir").length
  const fileCount = entries.length - folderCount
  const fullPath = path ? `${root}/${path}` : root || "All files"
  return (
    <>
      <CompactHeading
        title={path ? nameOf(path) : "All files"}
        fullPath={fullPath}
        meta={
          <>
            {folderCount} folder{folderCount === 1 ? "" : "s"} · {fileCount}{" "}
            file{fileCount === 1 ? "" : "s"}
          </>
        }
      />
      {entries.length === 0 ? (
        <Empty className="rounded-xl bg-card shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTypeIcon name="" type="dir" open />
            </EmptyMedia>
            <EmptyTitle>This folder is empty</EmptyTitle>
            <EmptyDescription>
              There is nothing to show here yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col rounded-xl bg-card shadow-sm">
          {entries.map((entry, index) => (
            <EntryRow
              key={entry.path}
              entry={entry}
              isFirst={index === 0}
              isLast={index === entries.length - 1}
            />
          ))}
        </div>
      )}
    </>
  )
}

function EntryRow({
  entry,
  isFirst,
  isLast,
}: {
  entry: RemoteEntry
  isFirst: boolean
  isLast: boolean
}) {
  return (
    <EntryContextMenu entry={entry}>
      <Link
        to="/$"
        params={{ _splat: entry.path }}
        className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--sand-100)] ${isFirst ? "rounded-t-xl" : ""} ${isLast ? "rounded-b-xl" : ""}`}
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-[var(--navy-500)]">
          <FileTypeIcon
            name={entry.name}
            type={entry.type}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-[var(--navy-700)]">
            {entry.name}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {entry.type === "dir" ? "Folder" : formatBytes(entry.size)} ·{" "}
            {formatDate(entry.modifiedAt)}
          </span>
        </span>
        <ChevronRightIcon className="size-4 text-[var(--stone-400)]" />
      </Link>
    </EntryContextMenu>
  )
}

function FileView({ data }: { data: FileData }) {
  const name = nameOf(data.path)
  const kind = fileKindOf(name)
  return (
    <>
      {kind === "markdown" && data.content !== null ? (
        <MarkdownCard key={data.path} path={data.path} content={data.content} />
      ) : kind === "text" && data.content !== null ? (
        <React.Suspense fallback={<ViewerFallback />}>
          <TextViewer path={data.path} content={data.content} />
        </React.Suspense>
      ) : kind === "html" ? (
        <React.Suspense fallback={<ViewerFallback />}>
          <HtmlViewer path={data.path} content={data.content} />
        </React.Suspense>
      ) : kind === "pdf" ? (
        <PdfViewer path={data.path} />
      ) : kind === "image" ? (
        <ImageViewer path={data.path} />
      ) : kind === "database" ? (
        <React.Suspense fallback={<ViewerFallback />}>
          <DatabaseView path={data.path} />
        </React.Suspense>
      ) : (kind === "markdown" || kind === "text") && data.content === null ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>This file is too large to preview</AlertTitle>
          <AlertDescription>
            <a className="underline" href={rawFileUrl(data.path, true)}>
              Download it
            </a>{" "}
            to read it on your computer.
          </AlertDescription>
        </Alert>
      ) : (
        <UnsupportedViewer path={data.path} name={name} />
      )}
    </>
  )
}

/**
 * A markdown file's card. Markdown always opens straight into the Notion-style
 * WYSIWYG editor, which autosaves over SSH as you type. The editor only runs in
 * the browser (it needs the DOM), so the server-rendered first paint shows the
 * read-only render and we swap in the live editor once mounted — no blank flash
 * and no SSR crash. `text` holds the latest saved contents so the placeholder
 * stays in sync without refetching.
 */
function MarkdownCard({ path, content }: { path: string; content: string }) {
  const [mounted, setMounted] = React.useState(false)
  const [text, setText] = React.useState(content)
  const queryClient = useQueryClient()

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Keep in sync if the loader refetches this file (e.g. a remote change).
  React.useEffect(() => {
    setText(content)
  }, [content])

  const { mutateAsync: saveMutate } = useMutation({
    mutationFn: (full: string) => saveFile({ data: { path, content: full } }),
    onSuccess: (_result, full) => {
      setText(full)
      // Patch the cached file view so reopening shows the saved text without a
      // refetch that would yank the editor out from under the user.
      queryClient.setQueryData<BrowseResult>(
        browseQueryOptions(path).queryKey,
        (old) => {
          if (!old || old.kind !== "file") return old
          return { ...old, content: full }
        }
      )
      // The file's size/mtime changed — let the tree refresh in the background.
      void queryClient.invalidateQueries({ queryKey: ["tree"] })
    },
  })

  const handleSave = React.useCallback(
    async (full: string) => {
      await saveMutate(full)
    },
    [saveMutate]
  )

  return (
    // No horizontal padding here: in edit mode BlockNote supplies its own 54px
    // content gutter (room for the drag/＋ handles), and the read-only
    // placeholder matches that inset so nothing shifts or overflows the card.
    <div className="rounded-xl bg-card py-7 shadow-sm">
      {mounted ? (
        <React.Suspense fallback={<MarkdownReadOnly path={path} text={text} />}>
          <MarkdownEditor
            key={path}
            content={text}
            onSave={handleSave}
            baseDir={parentOf(path)}
            docName={nameOf(path)}
          />
        </React.Suspense>
      ) : (
        <MarkdownReadOnly path={path} text={text} />
      )}
    </div>
  )
}

function MarkdownReadOnly({ path, text }: { path: string; text: string }) {
  return (
    <div className="px-[54px]">
      <React.Suspense fallback={<ViewerFallback />}>
        <MarkdownViewer path={path} content={text} />
      </React.Suspense>
    </div>
  )
}

function SearchResults({
  query,
  results,
}: {
  query: string
  results: Array<SearchResult>
}) {
  const { tree } = useTree()
  const root = tree?.root ?? ""
  return (
    <>
      <CompactHeading
        title={`Results for “${query}”`}
        fullPath={
          root
            ? `Search across ${root} for “${query}”`
            : `Search for “${query}”`
        }
        meta={
          <>
            {results.length} match{results.length === 1 ? "" : "es"}
          </>
        }
      />
      {results.length === 0 ? (
        <Empty className="rounded-xl bg-card shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing found</EmptyTitle>
            <EmptyDescription>
              No file names or contents match “{query}”. Try a shorter word.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col rounded-xl bg-card shadow-sm">
          {results.map((result, index) => (
            <EntryContextMenu key={result.path} entry={result}>
              <Link
                to="/$"
                params={{ _splat: result.path }}
                className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--sand-100)] ${index === 0 ? "rounded-t-xl" : ""} ${index === results.length - 1 ? "rounded-b-xl" : ""}`}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-[var(--navy-500)]">
                  <FileTypeIcon
                    name={nameOf(result.path)}
                    type={result.type}
                    className="size-4"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[var(--navy-700)]">
                    {nameOf(result.path)}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {result.path}
                  </span>
                </span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {result.matchedBy === "name" ? "name" : "in text"}
                </Badge>
              </Link>
            </EntryContextMenu>
          ))}
        </div>
      )}
    </>
  )
}

function ViewerFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

export function PendingView() {
  return (
    <ExplorerShell activePath="" file={null}>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </ExplorerShell>
  )
}

export function ErrorView({ error }: { error: Error }) {
  const router = useRouter()
  return (
    <ExplorerShell activePath="" file={null}>
      <Alert variant="destructive" className="bg-card shadow-sm">
        <TriangleAlertIcon />
        <AlertTitle>Could not reach the server</AlertTitle>
        <AlertDescription>
          <p className="font-mono text-xs">{error.message}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => router.invalidate()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </ExplorerShell>
  )
}
