import * as React from "react"
import {
  CheckCircle2Icon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ToastVariant = "info" | "success" | "error"

interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  action?: ToastAction
  durationMs?: number
}

interface ToastRecord extends ToastInput {
  id: number
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (input: ToastInput) => number
  dismiss: (id: number) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)
let nextToastId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Array<ToastRecord>>([])

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toast = React.useCallback((input: ToastInput) => {
    const id = nextToastId++
    setToasts((current) => [
      ...current.slice(-3),
      { ...input, id, variant: input.variant ?? "info" },
    ])
    return id
  }, [])

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((record) => (
          <ToastCard key={record.id} toast={record} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({
  toast,
  dismiss,
}: {
  toast: ToastRecord
  dismiss: (id: number) => void
}) {
  const [acting, setActing] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const duration = toast.durationMs ?? (toast.action ? 10_000 : 5_000)
    if (duration <= 0 || acting) return
    const timer = window.setTimeout(() => dismiss(toast.id), duration)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.durationMs, toast.action, acting, dismiss])

  const Icon =
    toast.variant === "success"
      ? CheckCircle2Icon
      : toast.variant === "error"
        ? TriangleAlertIcon
        : InfoIcon

  async function runAction() {
    if (!toast.action || acting) return
    setActing(true)
    setActionError(null)
    try {
      await toast.action.onClick()
      dismiss(toast.id)
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed"
      )
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-lg",
        toast.variant === "error" && "border-destructive/25"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          toast.variant === "success"
            ? "text-[var(--green-600)]"
            : toast.variant === "error"
              ? "text-destructive"
              : "text-[var(--navy-500)]"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--navy-700)]">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs break-words text-muted-foreground">
            {toast.description}
          </p>
        )}
        {actionError && (
          <p className="mt-1 text-xs break-words text-destructive">
            {actionError}
          </p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          disabled={acting}
          onClick={() => void runAction()}
          className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--navy-600)] hover:bg-muted disabled:opacity-50"
        >
          {acting ? "Working…" : toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error("useToast must be used within ToastProvider")
  return context
}

export type { ToastInput }
