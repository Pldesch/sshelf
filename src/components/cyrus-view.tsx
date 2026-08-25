import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  ArchiveIcon,
  BotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { archiveWorktree } from "@/server/cyrus"
import { cyrusOverviewQueryOptions } from "@/lib/queries"
import { formatAge } from "@/lib/cyrus"
import { formatBytes } from "@/lib/file-kinds"
import type { QueryClient } from "@tanstack/react-query"
import type {
  CyrusOverview,
  CyrusWorktree,
  PullRequestInfo,
} from "@/server/cyrus"

export async function cyrusLoader(queryClient: QueryClient) {
  await queryClient.ensureQueryData(cyrusOverviewQueryOptions())
}

export function CyrusView() {
  const { data } = useSuspenseQuery(cyrusOverviewQueryOptions())
  return (
    <CyrusShell>
      {data.stale && (
        <Alert className="mb-5 bg-card shadow-sm">
          <WifiOffIcon />
          <AlertTitle>The server is unreachable right now</AlertTitle>
          <AlertDescription>
            Showing the last known status. It will refresh automatically once
            the connection is back.
          </AlertDescription>
        </Alert>
      )}
      <ServiceCard overview={data} />
      <Tabs defaultValue="worktrees">
        <TabsList>
          <TabsTrigger value="worktrees">
            Worktrees
            <Badge variant="secondary" className="ml-1">
              {data.worktrees.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions
            <Badge variant="secondary" className="ml-1">
              {data.sessions.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="worktrees">
          <WorktreesCard overview={data} />
        </TabsContent>
        <TabsContent value="sessions">
          <SessionsCard overview={data} />
        </TabsContent>
      </Tabs>
    </CyrusShell>
  )
}

function CyrusShell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = React.useState(false)

  async function refresh() {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ["cyrus"] })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 bg-background/85 px-5 py-3 backdrop-blur-md">
        <SidebarTrigger />
        <h1 className="flex items-center gap-2 text-base font-semibold text-[var(--navy-700)]">
          <BotIcon className="size-4" aria-hidden />
          Cyrus
        </h1>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={refreshing ? "animate-spin" : undefined}
          />
          Refresh
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-[960px] min-w-0 flex-col gap-5 px-8 pt-3 pb-12">
        {children}
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[13px] font-semibold tracking-[0.02em] text-[var(--navy-700)] uppercase">
      {children}
    </h2>
  )
}

function StateDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`size-[7px] rounded-full ${ok ? "bg-[var(--green-500)]" : "bg-[var(--red-500)]"}`}
      aria-hidden
    />
  )
}

function ServiceCard({ overview }: { overview: CyrusOverview }) {
  const { service } = overview
  return (
    <section>
      <SectionHeading>
        Service {overview.host && `· ${overview.host}`}
      </SectionHeading>
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">
            cyrus
          </span>
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--navy-700)]">
            <StateDot ok={service.cyrus === "active"} />
            {service.cyrus}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">
            ngrok
          </span>
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--navy-700)]">
            <StateDot ok={service.ngrok === "active"} />
            {service.ngrok}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 overflow-hidden">
          <span className="font-mono text-[11px] text-muted-foreground">
            edge worker
          </span>
          <span
            className="truncate font-mono text-sm font-medium text-[var(--navy-700)]"
            title={service.api}
          >
            {service.api || "unreachable"}
          </span>
        </div>
      </div>
    </section>
  )
}

function SessionsCard({ overview }: { overview: CyrusOverview }) {
  const { sessions } = overview
  if (sessions.length === 0) return <EmptyCard message="No sessions yet." />
  return (
    <div className="flex flex-col rounded-xl bg-card shadow-sm">
      {sessions.map((session, index) => (
        <div
          key={session.issue}
          className={`flex items-center gap-4 px-5 py-3 ${index !== sessions.length - 1 ? "border-b border-border" : ""}`}
        >
          <Badge variant="secondary" className="font-mono text-[11px]">
            {session.issue}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--navy-700)]">
            {session.lastStep || "—"}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatAge(session.updatedAt)}
          </span>
        </div>
      ))}
    </div>
  )
}

function WorktreesCard({ overview }: { overview: CyrusOverview }) {
  const { worktrees } = overview
  if (worktrees.length === 0) return <EmptyCard message="No worktrees yet." />
  return (
    <div className="flex flex-col rounded-xl bg-card shadow-sm">
      {worktrees.map((worktree, index) => (
        <WorktreeRow
          key={worktree.path}
          worktree={worktree}
          isLast={index === worktrees.length - 1}
        />
      ))}
    </div>
  )
}

function EmptyCard({ message }: { message: string }) {
  return (
    <Empty className="rounded-xl bg-card shadow-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing here yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Bigger, higher-contrast than a plain Badge — this is the signal that
 * decides whether a worktree is safe to archive, so it should read at a
 * glance, not need a second look. */
/** Sized to match PrPill so the two pills read as one family, not a mismatched pair. */
function ActivePill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--orange-100)] py-1 pr-3 pl-2.5 text-sm font-semibold text-[var(--orange-700)]">
      <span className="presence-dot size-2" />
      Active
    </span>
  )
}

function PrPill({ pr }: { pr: PullRequestInfo }) {
  const config =
    pr.state === "MERGED"
      ? {
          Icon: GitMergeIcon,
          label: "Merged",
          classes: "bg-[var(--navy-700)] text-[var(--paper)]",
        }
      : pr.state === "CLOSED"
        ? {
            Icon: GitPullRequestClosedIcon,
            label: "Closed",
            classes: "bg-[var(--stone-200)] text-[var(--stone-700)]",
          }
        : {
            Icon: GitPullRequestArrowIcon,
            label: pr.isDraft ? "Draft" : "Open",
            classes: "bg-[var(--green-100)] text-[var(--green-600)]",
          }
  const { Icon } = config
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={pr.title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-2.5 text-sm font-semibold transition-opacity hover:opacity-80 ${config.classes}`}
    >
      <Icon className="size-4" />
      {config.label} #{pr.number}
    </a>
  )
}

function WorktreeRow({
  worktree,
  isLast,
}: {
  worktree: CyrusWorktree
  isLast: boolean
}) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [force, setForce] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const archiveMutation = useMutation({
    mutationFn: (vars: { path: string; force: boolean }) =>
      archiveWorktree({ data: vars }),
    onSuccess: () => {
      setConfirmOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["cyrus"] })
    },
  })

  function openConfirm() {
    setForce(false)
    setError(null)
    setConfirmOpen(true)
  }

  async function confirmArchive() {
    setError(null)
    try {
      await archiveMutation.mutateAsync({ path: worktree.path, force })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive")
    }
  }

  return (
    <>
      <div
        className={`flex items-center gap-4 px-5 py-3.5 ${!isLast ? "border-b border-border" : ""}`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[var(--navy-500)]">
          <GitBranchIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {worktree.linearUrl ? (
              <a
                href={worktree.linearUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open ${worktree.name} in Linear`}
                className="flex items-center gap-1 truncate text-[15px] font-semibold text-[var(--navy-700)] hover:underline"
              >
                {worktree.name}
                <ExternalLinkIcon className="size-3 text-muted-foreground" />
              </a>
            ) : (
              <span className="truncate text-[15px] font-semibold text-[var(--navy-700)]">
                {worktree.name}
              </span>
            )}
            {worktree.active && <ActivePill />}
            {worktree.pr && <PrPill pr={worktree.pr} />}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {worktree.branch || "—"}
          </span>
        </span>
        <span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {formatBytes(worktree.sizeBytes)}
          {worktree.dirty > 0 && (
            <>
              {" · "}
              <span className="text-[var(--red-500)]">
                {worktree.dirty} uncommitted
              </span>
            </>
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={openConfirm}
          disabled={worktree.active}
          title={
            worktree.active
              ? "An agent session is currently active in this worktree"
              : undefined
          }
        >
          <ArchiveIcon data-icon="inline-start" />
          Archive
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{worktree.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the local git worktree at{" "}
              <span className="font-mono text-xs">{worktree.path}</span>. The
              branch{" "}
              {worktree.branch && (
                <>
                  “<span className="font-mono">{worktree.branch}</span>”
                </>
              )}{" "}
              and any pull request stay exactly as they are — this only frees
              the disk space on the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {worktree.dirty > 0 && (
            <label className="flex items-center gap-2 text-sm text-[var(--red-500)]">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              Discard {worktree.dirty} uncommitted file
              {worktree.dirty === 1 ? "" : "s"} and archive anyway
            </label>
          )}
          {error && (
            <p className="font-mono text-xs break-all text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void confirmArchive()}
              disabled={
                archiveMutation.isPending || (worktree.dirty > 0 && !force)
              }
            >
              {archiveMutation.isPending && (
                <Spinner data-icon="inline-start" />
              )}
              {archiveMutation.isPending ? "Archiving…" : "Archive"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function CyrusPending() {
  return (
    <CyrusShell>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="mt-2 h-20 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </CyrusShell>
  )
}

export function CyrusError({ error }: { error: Error }) {
  return (
    <CyrusShell>
      <Alert variant="destructive" className="bg-card shadow-sm">
        <WifiOffIcon />
        <AlertTitle>Could not reach the server</AlertTitle>
        <AlertDescription>
          <p className="font-mono text-xs">{error.message}</p>
          <Button variant="secondary" size="sm" className="mt-3" asChild>
            <Link to="/cyrus">Try again</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </CyrusShell>
  )
}
