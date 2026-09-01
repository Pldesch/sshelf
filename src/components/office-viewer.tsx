import FileViewer from "@file-viewer/react"
import { spreadsheetRenderer } from "@file-viewer/renderer-spreadsheet"
import { wordRenderer } from "@file-viewer/renderer-word"
import { extensionOf, nameOf, rawFileUrl } from "@/lib/file-kinds"
import type { ViewerOptions } from "@file-viewer/react"

// The renderer packages specialize their mount element to HTMLDivElement while
// the shared viewer option intentionally erases it to HTMLElement. They use the
// same runtime plugin protocol, so keep that upstream type variance contained
// at this integration boundary.
const OFFICE_RENDERERS = [
  wordRenderer,
  spreadsheetRenderer,
] as unknown as NonNullable<ViewerOptions["renderers"]>

// @file-viewer/react reloads the current source whenever `options` changes by
// identity. Keep this object stable so unrelated explorer renders do not tear
// down the renderer (and reset its internal Word/Excel scroll position).
const OFFICE_VIEWER_OPTIONS = {
  theme: "light",
  locale: "en-US",
  rendererMode: "replace",
  renderers: OFFICE_RENDERERS,
  toolbar: {
    download: false,
    exportHtml: false,
    search: true,
    theme: false,
    zoom: true,
  },
  docx: {
    externalLinkPolicy: "block",
    externalResourcePolicy: "block",
  },
  spreadsheet: {
    resizableColumns: false,
    resizableRows: false,
  },
} satisfies ViewerOptions

export default function OfficeViewer({
  path,
  size,
}: {
  path: string
  size: number
}) {
  const name = nameOf(path)

  return (
    <FileViewer
      key={path}
      url={rawFileUrl(path)}
      filename={name}
      type={extensionOf(name)}
      size={size}
      aria-label={`Preview of ${name}`}
      className="min-h-0 w-full flex-1 overflow-hidden bg-card"
      // A zero flex basis gives the viewer a definite remaining height. Its
      // own Word/Excel scroll containers can then scroll instead of growing
      // behind the explorer pane's overflow boundary.
      style={{ height: 0 }}
      options={OFFICE_VIEWER_OPTIONS}
    />
  )
}
