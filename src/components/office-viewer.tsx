import FileViewer from "@file-viewer/react"
import { extensionOf, nameOf, rawFileUrl } from "@/lib/file-kinds"

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
      className="h-full min-h-0 w-full overflow-hidden bg-card"
      options={{
        theme: "light",
        locale: "en-US",
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
      }}
    />
  )
}
