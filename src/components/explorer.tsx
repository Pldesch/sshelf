import * as React from "react"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import {
  ChevronRightIcon,
  DownloadIcon,
  HouseIcon,
  SearchIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
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
import { Input } from "@/components/ui/input"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { browsePath, getSshHosts, searchFiles } from "@/server/files"
import {
  fileKindOf,
  formatBytes,
  formatDate,
  nameOf,
  rawFileUrl,
} from "@/lib/file-kinds"
import { useRemoteFileEvents } from "@/lib/use-file-events"
import type { BrowseResult } from "@/server/files"
import type { RemoteEntry, SearchResult, SshConfigHost } from "@/server/ssh"

// Heavy renderers (react-markdown, highlight.js) load in their own chunk
// so plain folder browsing never pays for them.
const MarkdownViewer = React.lazy(() => import("@/components/markdown-viewer"))
const TextViewer = React.lazy(() => import("@/components/text-viewer"))
const MarkdownEditor = React.lazy(() => import("@/components/markdown-editor"))
const HtmlViewer = React.lazy(() => import("@/components/html-viewer"))

export type PageData =
  | BrowseResult
  | { kind: "search"; query: string; results: Array<SearchResult> }
  | { kind: "setup"; hosts: Array<SshConfigHost>; current: string | null }

function isSetupRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SETUP_REQUIRED")
}

export async function explorerLoader(options: {
  path: string
  q?: string
  setup?: boolean
}): Promise<PageData> {
  if (options.setup) {
    return { kind: "setup", ...(await getSshHosts()) }
  }
  try {
    if (options.q) {
      return {
        kind: "search",
        query: options.q,
        results: await searchFiles({ data: { query: options.q } }),
      }
    }
    return await browsePath({ data: { path: options.path } })
  } catch (error) {
    // No server chosen yet — first-time use goes to the picker.
    if (isSetupRequired(error)) {
      return { kind: "setup", ...(await getSshHosts()) }
    }
    throw error
  }
}

export function ExplorerView({
  data,
  path,
  q,
}: {
  data: PageData
  path: string
  q?: string
}) {
  if (data.kind === "setup") {
    return <SetupScreen hosts={data.hosts} current={data.current} />
  }

  return (
    <ExplorerShell
      activePath={path}
      currentQuery={q}
      file={data.kind === "file" ? data : null}
    >
      {data.kind !== "search" && data.stale && (
        <Alert className="mb-5 bg-card shadow-sm">
          <WifiOffIcon />
          <AlertTitle>The server is unreachable right now</AlertTitle>
          <AlertDescription>
            You are looking at the last saved copy. It will refresh
            automatically once the connection is back.
          </AlertDescription>
        </Alert>
      )}
      {data.kind === "search" ? (
        <SearchResults query={data.query} results={data.results} />
      ) : data.kind === "dir" ? (
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
  file: Extract<PageData, { kind: "file" }> | null
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  useRemoteFileEvents()
  return (
    <SidebarProvider>
      <AppSidebar activePath={activePath} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/85 px-5 py-3 backdrop-blur-md">
          <SidebarTrigger />
          <PathBreadcrumb path={activePath} isSearch={Boolean(currentQuery)} />
          <div className="flex-1" />
          <form
            className="w-full max-w-64"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const query = String(form.get("q") ?? "").trim()
              if (query) navigate({ to: "/", search: { q: query } })
            }}
          >
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                placeholder="Search all files…"
                defaultValue={currentQuery ?? ""}
                className="border-transparent bg-card pl-9 shadow-xs"
              />
            </div>
          </form>
          {file && (
            <>
              <span
                title={`/home/ubuntu/${file.path}`}
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
        <div className="mx-auto w-full max-w-[960px] px-8 pt-3 pb-12">
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
  const folderCount = entries.filter((e) => e.type === "dir").length
  const fileCount = entries.length - folderCount
  return (
    <>
      <CompactHeading
        title={path ? nameOf(path) : "All files"}
        fullPath={`/home/ubuntu${path ? `/${path}` : ""}`}
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

function FileView({ data }: { data: Extract<PageData, { kind: "file" }> }) {
  const name = nameOf(data.path)
  const kind = fileKindOf(name)
  return (
    <>
      {kind === "markdown" && data.content !== null ? (
        <MarkdownCard path={data.path} content={data.content} />
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

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Keep in sync if the loader refetches this file (e.g. a remote change).
  React.useEffect(() => {
    setText(content)
  }, [content])

  return (
    // No horizontal padding here: in edit mode BlockNote supplies its own 54px
    // content gutter (room for the drag/＋ handles), and the read-only
    // placeholder matches that inset so nothing shifts or overflows the card.
    <div className="rounded-xl bg-card py-7 shadow-sm">
      {mounted ? (
        <React.Suspense fallback={<MarkdownReadOnly path={path} text={text} />}>
          <MarkdownEditor
            key={path}
            path={path}
            content={text}
            onSaved={setText}
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
  return (
    <>
      <CompactHeading
        title={`Results for “${query}”`}
        fullPath={`Search across /home/ubuntu for “${query}”`}
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
