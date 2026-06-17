import { Link } from "@tanstack/react-router"
import { ArrowLeftRightIcon, FolderTree, RefreshCwIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { FileTree } from "@/components/file-tree"
import { useTree } from "@/lib/use-tree"

export function AppSidebar({ activePath }: { activePath: string }) {
  const { tree, state, refresh } = useTree()

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link to="/" className="flex items-center gap-2.5 px-1">
          <FolderTree className="size-7 text-[var(--paper)]" aria-hidden />
          <span className="text-base font-semibold tracking-tight text-[var(--paper)]">
            Explorer
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] tracking-[0.08em] uppercase">
            Files
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <FileTree
              entries={tree?.entries ?? null}
              activePath={activePath}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-lg bg-[var(--navy-700)] p-3">
          <FolderTree className="size-8 text-[var(--paper)]" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[13px] leading-none font-semibold text-[var(--paper)]">
              {tree?.host ?? "…"}
            </span>
            <span className="flex items-center gap-2">
              {state === "connected" ? (
                <>
                  <span className="presence-dot size-[7px]" />
                  <span className="font-mono text-[10px] text-[var(--navy-300)]">
                    connected
                  </span>
                </>
              ) : state === "connecting" ? (
                <>
                  <span className="size-[7px] rounded-full bg-[var(--navy-400)]" />
                  <span className="font-mono text-[10px] text-[var(--navy-300)]">
                    connecting…
                  </span>
                </>
              ) : (
                <>
                  <span className="size-[7px] rounded-full bg-[var(--red-500)]" />
                  <span className="font-mono text-[10px] text-[var(--red-500)]">
                    offline
                  </span>
                </>
              )}
            </span>
          </div>
          {state === "offline" && (
            <button
              onClick={() => refresh()}
              aria-label="Try to reconnect"
              className="flex size-7 items-center justify-center rounded-md text-[var(--navy-300)] transition-colors hover:bg-[var(--navy-600)] hover:text-[var(--paper)]"
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/"
                search={{ setup: true }}
                aria-label="Change server"
                className="flex size-7 items-center justify-center rounded-md text-[var(--navy-300)] transition-colors hover:bg-[var(--navy-600)] hover:text-[var(--paper)]"
              >
                <ArrowLeftRightIcon className="size-3.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top">Change server</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
