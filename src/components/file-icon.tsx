import {
  FileIcon as FileGenericIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  FileCodeIcon,
  FileSpreadsheetIcon,
  BookOpenTextIcon,
} from "lucide-react"
import { fileKindOf } from "@/lib/file-kinds"
import { cn } from "@/lib/utils"

export function FileTypeIcon({
  name,
  type,
  open = false,
  className,
}: {
  name: string
  type: "dir" | "file"
  open?: boolean
  className?: string
}) {
  if (type === "dir") {
    const Icon = open ? FolderOpenIcon : FolderIcon
    return <Icon className={cn("shrink-0", className)} />
  }
  const kind = fileKindOf(name)
  const Icon =
    kind === "markdown"
      ? FileTextIcon
      : kind === "pdf"
        ? BookOpenTextIcon
        : kind === "image"
          ? ImageIcon
          : kind === "spreadsheet"
            ? FileSpreadsheetIcon
            : kind === "word"
              ? FileTextIcon
              : kind === "text"
                ? FileCodeIcon
                : FileGenericIcon
  return <Icon className={cn("shrink-0", className)} />
}
