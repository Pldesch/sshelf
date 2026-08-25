import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  FilePlusIcon,
  FileUpIcon,
  FolderPlusIcon,
  FolderUpIcon,
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { createFile, createFolder } from "@/server/files"
import { refreshDirectoryQueries } from "@/lib/workspace-cache"
import { nameOf } from "@/lib/file-kinds"

type CreateKind = "file" | "folder"

export function DirectoryActions({ path }: { path: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast, dismiss } = useToast()
  const [createKind, setCreateKind] = React.useState<CreateKind | null>(null)
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)

  const createFileMutation = useMutation({
    mutationFn: (value: string) =>
      createFile({ data: { parentPath: path, name: value } }),
  })
  const createFolderMutation = useMutation({
    mutationFn: (value: string) =>
      createFolder({ data: { parentPath: path, name: value } }),
  })

  function openCreate(kind: CreateKind) {
    setName("")
    setError(null)
    setCreateKind(kind)
  }

  async function confirmCreate() {
    if (!createKind || !name.trim()) return
    setError(null)
    try {
      const result =
        createKind === "file"
          ? await createFileMutation.mutateAsync(name)
          : await createFolderMutation.mutateAsync(name)
      refreshDirectoryQueries(queryClient, path)
      setCreateKind(null)
      toast({
        title: `${createKind === "file" ? "File" : "Folder"} created`,
        description: result.path,
        variant: "success",
      })
      if (createKind === "file") {
        await navigate({ to: "/$", params: { _splat: result.path } })
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not create item"
      setError(message)
      toast({
        title: `Could not create ${createKind}`,
        description: message,
        variant: "error",
      })
    }
  }

  async function uploadPicked(
    fileList: FileList | null,
    useRelativePaths: boolean
  ) {
    if (!fileList?.length) return
    const files = Array.from(fileList)
    setUploading(true)
    const progressId = toast({
      title: `Importing ${files.length} file${files.length === 1 ? "" : "s"}…`,
      description: path || "All files",
      durationMs: 0,
    })
    try {
      const form = new FormData()
      form.set("parentPath", path)
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
      if (!response.ok)
        throw new Error((await response.text()) || "Import failed")
      refreshDirectoryQueries(queryClient, path)
      toast({
        title: "Import complete",
        description: `${files.length} file${files.length === 1 ? "" : "s"} added`,
        variant: "success",
      })
    } catch (cause) {
      toast({
        title: "Import failed",
        description:
          cause instanceof Error ? cause.message : "Could not import files",
        variant: "error",
      })
    } finally {
      dismiss(progressId)
      setUploading(false)
    }
  }

  const creating =
    createFileMutation.isPending || createFolderMutation.isPending
  const folderName = path ? nameOf(path) : "All files"

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openCreate("file")}
        >
          <FilePlusIcon data-icon="inline-start" />
          New file
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openCreate("folder")}
        >
          <FolderPlusIcon data-icon="inline-start" />
          New folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUpIcon data-icon="inline-start" />
          Import files
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderUpIcon data-icon="inline-start" />
          Import folder
        </Button>
      </div>

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
        ref={(element) => {
          folderInputRef.current = element
          if (element) element.setAttribute("webkitdirectory", "")
        }}
        type="file"
        hidden
        onChange={(event) => {
          void uploadPicked(event.target.files, true)
          event.target.value = ""
        }}
      />

      <AlertDialog
        open={createKind !== null}
        onOpenChange={(open) => !open && setCreateKind(null)}
      >
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmCreate()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                New {createKind ?? "item"} in “{folderName}”
              </AlertDialogTitle>
              <AlertDialogDescription>
                {createKind === "file"
                  ? "Enter the complete file name, including an extension when needed."
                  : "Enter a name for the new folder."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={`New ${createKind ?? "item"} name`}
              placeholder={createKind === "file" ? "notes.md" : "folder name"}
              disabled={creating}
              autoFocus
            />
            {error && (
              <p className="font-mono text-xs break-all text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={creating}>
                Cancel
              </AlertDialogCancel>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating && <Spinner data-icon="inline-start" />}
                {creating ? "Creating…" : `Create ${createKind ?? "item"}`}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
