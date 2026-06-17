import * as React from "react"
import { Link } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { EntryContextMenu } from "@/components/entry-context-menu"
import { FileTypeIcon } from "@/components/file-icon"
import type { RemoteEntry } from "@/server/ssh"

// Expansion survives route changes (the tree remounts when switching
// between the root route and path routes).
const expandedFolders = new Map<string, boolean>()

function childrenOf(
  entries: Array<RemoteEntry>,
  path: string
): Array<RemoteEntry> {
  const prefix = path ? `${path}/` : ""
  return entries.filter(
    (entry) =>
      entry.path.startsWith(prefix) &&
      entry.path !== path &&
      !entry.path.slice(prefix.length).includes("/")
  )
}

function FolderNode({
  entry,
  entries,
  activePath,
  defaultOpen = false,
}: {
  entry: RemoteEntry
  entries: Array<RemoteEntry>
  activePath: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(
    expandedFolders.get(entry.path) ??
      (defaultOpen ||
        activePath === entry.path ||
        activePath.startsWith(`${entry.path}/`))
  )

  function handleOpenChange(next: boolean) {
    expandedFolders.set(entry.path, next)
    setOpen(next)
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} asChild>
      <SidebarMenuItem>
        <EntryContextMenu entry={entry}>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              isActive={activePath === entry.path}
              tooltip={entry.name}
            >
              <ChevronRightIcon
                className="transition-transform duration-200"
                style={{ rotate: open ? "90deg" : "0deg" }}
              />
              <FileTypeIcon name={entry.name} type="dir" open={open} />
              <span className="truncate">{entry.name}</span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
        </EntryContextMenu>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            <TreeLevel
              entries={entries}
              parentPath={entry.path}
              activePath={activePath}
            />
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function FileNode({
  entry,
  activePath,
}: {
  entry: RemoteEntry
  activePath: string
}) {
  return (
    <SidebarMenuItem>
      <EntryContextMenu entry={entry}>
        <SidebarMenuButton
          asChild
          isActive={activePath === entry.path}
          tooltip={entry.name}
        >
          <Link to="/$" params={{ _splat: entry.path }}>
            <FileTypeIcon name={entry.name} type="file" />
            <span className="truncate">{entry.name}</span>
          </Link>
        </SidebarMenuButton>
      </EntryContextMenu>
    </SidebarMenuItem>
  )
}

function TreeLevel({
  entries,
  parentPath,
  activePath,
}: {
  entries: Array<RemoteEntry>
  parentPath: string
  activePath: string
}) {
  return (
    <>
      {childrenOf(entries, parentPath).map((entry) =>
        entry.type === "dir" ? (
          <FolderNode
            key={entry.path}
            entry={entry}
            entries={entries}
            activePath={activePath}
            defaultOpen={parentPath === "" && entry.name === "Process"}
          />
        ) : (
          <FileNode key={entry.path} entry={entry} activePath={activePath} />
        )
      )}
    </>
  )
}

export function FileTree({
  entries,
  activePath,
}: {
  entries: Array<RemoteEntry> | null
  activePath: string
}) {
  if (entries === null) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <Skeleton className="h-4 w-4/5 bg-sidebar-accent" />
        <Skeleton className="h-4 w-3/5 bg-sidebar-accent" />
        <Skeleton className="h-4 w-2/3 bg-sidebar-accent" />
      </div>
    )
  }
  return (
    <SidebarMenu>
      <TreeLevel entries={entries} parentPath="" activePath={activePath} />
    </SidebarMenu>
  )
}
