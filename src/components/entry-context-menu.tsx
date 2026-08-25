import * as React from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CopyIcon,
  DownloadIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FileUpIcon,
  FolderInputIcon,
  FolderPlusIcon,
  FolderUpIcon,
  Trash2Icon,
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
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  createFile,
  createFolder,
  deletePath,
  moveEntry,
  renameFile,
} from "@/server/files"
import { useWorkspace } from "@/lib/use-tree"
import { browseQueryOptions, directoriesQueryOptions } from "@/lib/queries"
import { nameOf, parentOf, rawFileUrl } from "@/lib/file-kinds"

const ENTRY_DRAG_MIME = "application/x-sshelf-entry"

interface EntryRef {
  path: string
  type: "dir" | "file"
}

export function EntryContextMenu({
  entry,
  children,
}: {
  entry: EntryRef
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { tree } = useWorkspace()
  const root = tree?.root ?? ""
  const queryClient = useQueryClient()

  const refreshDirectories = React.useCallback(
    (...paths: Array<string>) => {
      for (const path of new Set(paths)) {
        void queryClient.invalidateQueries({
          queryKey: browseQueryOptions(path).queryKey,
        })
        if (path === "") {
          void queryClient.invalidateQueries({ queryKey: ["tree"] })
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["directories"] })
    },
    [queryClient]
  )

  const forgetPath = React.useCallback(
    (path: string) => {
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === "browse" &&
          typeof query.queryKey[1] === "string" &&
          (query.queryKey[1] === path ||
            query.queryKey[1].startsWith(`${path}/`)),
      })
    },
    [queryClient]
  )

  const deleteMutation = useMutation({
    mutationFn: (path: string) => deletePath({ data: { path } }),
  })
  const renameMutation = useMutation({
    mutationFn: (vars: { path: string; name: string }) =>
      renameFile({ data: vars }),
  })
  const moveMutation = useMutation({
    mutationFn: (vars: { path: string; parentPath: string }) =>
      moveEntry({ data: vars }),
  })
  const createFolderMutation = useMutation({
    mutationFn: (vars: { parentPath: string; name: string }) =>
      createFolder({ data: vars }),
  })
  const createFileMutation = useMutation({
    mutationFn: (vars: { parentPath: string; name: string }) =>
      createFile({ data: vars }),
  })

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [moving, setMoving] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [moveError, setMoveError] = React.useState<string | null>(null)
  const [dropActive, setDropActive] = React.useState(false)
  const [nextName, setNextName] = React.useState("")
  const [destinationPath, setDestinationPath] = React.useState("")
  const [destinationOptions, setDestinationOptions] = React.useState<
    Array<{ path: string; name: string }>
  >([{ path: "", name: "All files" }])
  const [createFolderOpen, setCreateFolderOpen] = React.useState(false)
  const [newFolderName, setNewFolderName] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [createFileOpen, setCreateFileOpen] = React.useState(false)
  const [newFileName, setNewFileName] = React.useState("")
  const [creatingFile, setCreatingFile] = React.useState(false)
  const [createFileError, setCreateFileError] = React.useState<string | null>(
    null
  )
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [uploadLabel, setUploadLabel] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)
  const name = nameOf(entry.path)
  const isFolder = entry.type === "dir"
  const currentParent = parentOf(entry.path)
  const entryKind = isFolder ? "folder" : "file"

  function currentPath() {
    return decodeURIComponent(location.pathname).replace(/^\/+/, "")
  }

  async function navigateToPath(path: string) {
    if (path) {
      await navigate({ to: "/$", params: { _splat: path } })
    } else {
      await navigate({ to: "/" })
    }
  }

  async function finishMutation(oldPath: string, newPath: string) {
    refreshDirectories(parentOf(oldPath), parentOf(newPath))
    forgetPath(oldPath)
    const current = currentPath()
    if (current === oldPath) {
      await navigateToPath(newPath)
    } else if (current.startsWith(`${oldPath}/`)) {
      await navigateToPath(`${newPath}${current.slice(oldPath.length)}`)
    }
  }

  async function loadDestinationOptions() {
    try {
      const result = await queryClient.ensureQueryData(
        directoriesQueryOptions()
      )
      setDestinationOptions([
        { path: "", name: "All files" },
        ...result
          .filter(
            (path) =>
              !isFolder ||
              (path !== entry.path && !path.startsWith(`${entry.path}/`))
          )
          .map((path) => ({ path, name: path })),
      ])
    } catch (err) {
      setMoveError(
        err instanceof Error ? err.message : "Could not load folders"
      )
    }
  }

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync(entry.path)
      refreshDirectories(parentOf(entry.path))
      forgetPath(entry.path)
      setConfirmOpen(false)
      // If the deleted item (or something inside it) is open, step up.
      const current = currentPath()
      if (current === entry.path || current.startsWith(`${entry.path}/`)) {
        const parent = parentOf(entry.path)
        await navigateToPath(parent)
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDeleting(false)
    }
  }

  async function confirmRename() {
    if (renaming) return
    setRenaming(true)
    setRenameError(null)
    try {
      const result = await renameMutation.mutateAsync({
        path: entry.path,
        name: nextName,
      })
      setRenameOpen(false)
      await finishMutation(entry.path, result.path)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed")
    } finally {
      setRenaming(false)
    }
  }

  async function confirmMove() {
    if (moving) return
    setMoving(true)
    setMoveError(null)
    try {
      const result = await moveMutation.mutateAsync({
        path: entry.path,
        parentPath: destinationPath,
      })
      setMoveOpen(false)
      await finishMutation(entry.path, result.path)
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Move failed")
    } finally {
      setMoving(false)
    }
  }

  async function confirmCreateFolder() {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      await createFolderMutation.mutateAsync({
        parentPath: entry.path,
        name: newFolderName,
      })
      setCreateFolderOpen(false)
      refreshDirectories(entry.path)
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Could not create folder"
      )
    } finally {
      setCreating(false)
    }
  }

  async function confirmCreateFile() {
    if (creatingFile) return
    setCreatingFile(true)
    setCreateFileError(null)
    try {
      const result = await createFileMutation.mutateAsync({
        parentPath: entry.path,
        name: newFileName,
      })
      setCreateFileOpen(false)
      refreshDirectories(entry.path)
      // Open the new file straight away in the markdown editor.
      await navigateToPath(result.path)
    } catch (err) {
      setCreateFileError(
        err instanceof Error ? err.message : "Could not create file"
      )
    } finally {
      setCreatingFile(false)
    }
  }

  async function uploadPicked(
    fileList: FileList | null,
    useRelativePaths: boolean
  ) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    const count = files.length
    const plural = count === 1 ? "" : "s"
    setUploadError(null)
    setUploading(true)
    setUploadLabel(
      useRelativePaths
        ? `Importing folder — ${count} file${plural}…`
        : `Importing ${count} file${plural}…`
    )
    setUploadOpen(true)
    try {
      const form = new FormData()
      form.set("parentPath", entry.path)
      for (const file of files) {
        form.append("files", file)
        form.append(
          "paths",
          useRelativePaths && file.webkitRelativePath
            ? file.webkitRelativePath
            : file.name
        )
      }
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      })
      if (!response.ok) {
        throw new Error((await response.text()) || "Upload failed")
      }
      setUploadOpen(false)
      refreshDirectories(entry.path)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  function readDraggedEntry(event: React.DragEvent): EntryRef | null {
    const raw = event.dataTransfer.getData(ENTRY_DRAG_MIME)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<EntryRef>
      if (
        typeof parsed.path === "string" &&
        (parsed.type === "dir" || parsed.type === "file")
      ) {
        return { path: parsed.path, type: parsed.type }
      }
    } catch {
      // Ignore non-explorer drags.
    }
    return null
  }

  function canDropOnThisFolder(dragged: EntryRef | null) {
    if (!isFolder || !dragged) return false
    if (dragged.path === entry.path) return false
    if (dragged.type === "dir" && entry.path.startsWith(`${dragged.path}/`)) {
      return false
    }
    return parentOf(dragged.path) !== entry.path
  }

  function handleDragStart(event: React.DragEvent) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(ENTRY_DRAG_MIME, JSON.stringify(entry))
    event.dataTransfer.setData("text/plain", entry.path)
  }

  function handleDragOver(event: React.DragEvent) {
    if (!isFolder || !event.dataTransfer.types.includes(ENTRY_DRAG_MIME)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDropActive(true)
  }

  function handleDragLeave() {
    setDropActive(false)
  }

  async function handleDrop(event: React.DragEvent) {
    setDropActive(false)
    if (!isFolder) return
    const dragged = readDraggedEntry(event)
    if (!dragged || !canDropOnThisFolder(dragged)) return

    event.preventDefault()
    event.stopPropagation()

    try {
      const result = await moveMutation.mutateAsync({
        path: dragged.path,
        parentPath: entry.path,
      })
      await finishMutation(dragged.path, result.path)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Move failed")
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          draggable
          className={
            dropActive
              ? "bg-[var(--sand-100)] outline-2 outline-primary/40"
              : undefined
          }
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDragEnd={handleDragLeave}
          onDrop={(event) => void handleDrop(event)}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isFolder && (
            <>
              <ContextMenuItem
                onSelect={() => {
                  setNewFolderName("")
                  setCreateError(null)
                  setCreateFolderOpen(true)
                }}
              >
                <FolderPlusIcon />
                New folder…
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  setNewFileName("")
                  setCreateFileError(null)
                  setCreateFileOpen(true)
                }}
              >
                <FilePlusIcon />
                New markdown file…
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  // Defer the click so the menu finishes unmounting first.
                  setTimeout(() => fileInputRef.current?.click(), 0)
                }}
              >
                <FileUpIcon />
                Import files…
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  setTimeout(() => folderInputRef.current?.click(), 0)
                }}
              >
                <FolderUpIcon />
                Import folder…
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {entry.type === "file" && (
            <ContextMenuItem asChild>
              <a href={rawFileUrl(entry.path, true)}>
                <DownloadIcon />
                Download
              </a>
            </ContextMenuItem>
          )}
          {entry.type === "file" && (
            <ContextMenuItem
              onSelect={() => {
                setNextName(name)
                setRenameError(null)
                setRenameOpen(true)
              }}
            >
              <FilePenLineIcon />
              Rename file
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => {
              setDestinationPath(currentParent)
              setDestinationOptions(
                currentParent
                  ? [
                      { path: "", name: "All files" },
                      { path: currentParent, name: currentParent },
                    ]
                  : [{ path: "", name: "All files" }]
              )
              setMoveError(null)
              setMoveOpen(true)
              void loadDestinationOptions()
            }}
          >
            <FolderInputIcon />
            Move {entryKind}…
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              navigator.clipboard.writeText(
                root ? `${root}/${entry.path}` : entry.path
              )
            }
          >
            <CopyIcon />
            Copy path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              setDeleteError(null)
              setConfirmOpen(true)
            }}
          >
            <Trash2Icon />
            Delete {isFolder ? "folder" : "file"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void uploadPicked(event.target.files, false)
          event.target.value = ""
        }}
      />
      <input
        ref={(el) => {
          folderInputRef.current = el
          // webkitdirectory has no React typing; set it imperatively.
          if (el) el.setAttribute("webkitdirectory", "")
        }}
        type="file"
        hidden
        onChange={(event) => {
          void uploadPicked(event.target.files, true)
          event.target.value = ""
        }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {isFolder ? "folder" : ""} “{name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              {isFolder ? (
                <>
                  the folder and <strong>everything inside it</strong>
                </>
              ) : (
                "this file"
              )}{" "}
              from the server. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="font-mono text-xs break-all text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Spinner data-icon="inline-start" />}
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmRename()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Rename “{name}”</AlertDialogTitle>
              <AlertDialogDescription>
                Enter a new file name. The file stays in the same folder.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
              aria-label="New file name"
              disabled={renaming}
              autoFocus
            />
            {renameError && (
              <p className="font-mono text-xs break-all text-destructive">
                {renameError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={renaming}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={renaming || nextName.trim() === name}
              >
                {renaming && <Spinner data-icon="inline-start" />}
                {renaming ? "Renaming…" : "Rename"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={moveOpen} onOpenChange={setMoveOpen}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmMove()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Move {entryKind} “{name}”
              </AlertDialogTitle>
              <AlertDialogDescription>
                Choose the folder that should contain this {entryKind}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <select
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              value={destinationPath}
              onChange={(event) => setDestinationPath(event.target.value)}
              disabled={moving}
              aria-label="Destination folder"
            >
              {destinationOptions.map((option) => (
                <option key={option.path || "__root__"} value={option.path}>
                  {option.path ? option.name : root || "All files"}
                </option>
              ))}
            </select>
            {moveError && (
              <p className="font-mono text-xs break-all text-destructive">
                {moveError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={moving}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={moving || destinationPath === currentParent}
              >
                {moving && <Spinner data-icon="inline-start" />}
                {moving ? "Moving…" : "Move"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmCreateFolder()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>New folder in “{name}”</AlertDialogTitle>
              <AlertDialogDescription>
                Enter a name for the new folder.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              aria-label="New folder name"
              placeholder="folder name"
              disabled={creating}
              autoFocus
            />
            {createError && (
              <p className="font-mono text-xs break-all text-destructive">
                {createError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={creating}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={creating || newFolderName.trim() === ""}
              >
                {creating && <Spinner data-icon="inline-start" />}
                {creating ? "Creating…" : "Create folder"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={createFileOpen} onOpenChange={setCreateFileOpen}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmCreateFile()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>New markdown file in “{name}”</AlertDialogTitle>
              <AlertDialogDescription>
                Enter a name for the new file. The “.md” extension is added
                automatically.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Input
                value={newFileName}
                onChange={(event) =>
                  // Strip any ".md" the user types — the suffix is fixed.
                  setNewFileName(event.target.value.replace(/\.md$/i, ""))
                }
                aria-label="New markdown file name"
                placeholder="file name"
                disabled={creatingFile}
                autoFocus
                className="flex-1"
              />
              <span className="font-mono text-sm text-muted-foreground">
                .md
              </span>
            </div>
            {createFileError && (
              <p className="font-mono text-xs break-all text-destructive">
                {createFileError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={creatingFile}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={creatingFile || newFileName.trim() === ""}
              >
                {creatingFile && <Spinner data-icon="inline-start" />}
                {creatingFile ? "Creating…" : "Create file"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {uploading ? "Importing…" : "Import failed"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {uploading
                ? `${uploadLabel} into “${name}”.`
                : "Some files could not be uploaded."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {uploading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner data-icon="inline-start" />
              Sending files to the server…
            </p>
          )}
          {uploadError && (
            <p className="font-mono text-xs break-all text-destructive">
              {uploadError}
            </p>
          )}
          {!uploading && (
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
