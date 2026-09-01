import { defineConfig } from "vite"
import { fileViewerRenderers } from "@file-viewer/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    fileViewerRenderers({
      formats: ["doc", "docx", "xls", "xlsx"],
      copyAssets: {
        outDir: "dist/client",
        baseDir: "file-viewer",
        mode: "both",
      },
      chunkStrategy: "renderer",
    }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
