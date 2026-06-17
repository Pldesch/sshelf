import * as React from "react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { CheckIcon, FolderTree, ServerIcon, TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { selectSshHost } from "@/server/files"
import { refreshTree } from "@/lib/use-tree"
import { cn } from "@/lib/utils"
import type { SshConfigHost } from "@/server/ssh"

export const HOST_STORAGE_KEY = "explorer.ssh-host"

export function SetupScreen({
  hosts,
  current,
}: {
  hosts: Array<SshConfigHost>
  current: string | null
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const [selected, setSelected] = React.useState<string | null>(() => {
    if (current) return current
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(HOST_STORAGE_KEY)
      if (stored && hosts.some((h) => h.alias === stored)) return stored
    }
    return hosts.length === 1 ? hosts[0].alias : null
  })
  const [connecting, setConnecting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function connect() {
    if (!selected || connecting) return
    setConnecting(true)
    setError(null)
    try {
      await selectSshHost({ data: { host: selected } })
      window.localStorage.setItem(HOST_STORAGE_KEY, selected)
      refreshTree()
      await router.invalidate()
      await navigate({ to: "/", search: {} })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="bg-background flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <FolderTree className="size-14 text-[var(--orange-500)]" aria-hidden />
          <h1 className="text-2xl font-semibold text-[var(--navy-700)]">
            Choose your server
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            These are the SSH servers set up on this computer (from{" "}
            <code className="font-mono text-xs">~/.ssh/config</code>). Pick the
            one you want to browse — you can change it later.
          </p>
        </div>

        {hosts.length === 0 ? (
          <Empty className="bg-card rounded-xl shadow-sm">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ServerIcon />
              </EmptyMedia>
              <EmptyTitle>No SSH servers found</EmptyTitle>
              <EmptyDescription>
                Add a host entry to <code>~/.ssh/config</code> and reload this
                page.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="bg-card flex flex-col rounded-xl shadow-sm">
            {hosts.map((host, index) => {
              const isSelected = selected === host.alias
              return (
                <button
                  key={host.alias}
                  type="button"
                  onClick={() => setSelected(host.alias)}
                  className={cn(
                    "flex items-center gap-4 px-5 py-3.5 text-left transition-colors",
                    index === 0 && "rounded-t-xl",
                    index === hosts.length - 1 && "rounded-b-xl",
                    isSelected
                      ? "bg-[var(--orange-100)]"
                      : "hover:bg-[var(--sand-100)]",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg",
                      isSelected
                        ? "bg-[var(--orange-500)] text-white"
                        : "bg-muted text-[var(--navy-500)]",
                    )}
                  >
                    {isSelected ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <ServerIcon className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-[var(--navy-700)]">
                      {host.alias}
                    </span>
                    {(host.user || host.hostName) && (
                      <span className="text-muted-foreground block truncate font-mono text-[11px]">
                        {host.user ? `${host.user}@` : ""}
                        {host.hostName ?? ""}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="bg-card shadow-sm">
            <TriangleAlertIcon />
            <AlertTitle>Connection failed</AlertTitle>
            <AlertDescription>
              <p className="font-mono text-xs break-all">{error}</p>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-center gap-3">
          {current && (
            <Button
              variant="secondary"
              onClick={() => navigate({ to: "/", search: {} })}
              disabled={connecting}
            >
              Cancel
            </Button>
          )}
          <Button
            onClick={connect}
            disabled={!selected || connecting || hosts.length === 0}
          >
            {connecting && <Spinner data-icon="inline-start" />}
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
    </div>
  )
}
