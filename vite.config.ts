import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    proxy: {
      "/estradeck/api": {
        target: "http://127.0.0.1:5174",
        rewrite: (path) => path.replace(/^\/estradeck/, ""),
      },
      "/estradeck/decks": {
        target: "http://127.0.0.1:5174",
        rewrite: (path) => path.replace(/^\/estradeck/, ""),
      },
      "/estradeck/themes": {
        target: "http://127.0.0.1:5174",
        rewrite: (path) => path.replace(/^\/estradeck/, ""),
      },
      "/estradeck/ws": {
        target: "ws://127.0.0.1:5174",
        ws: true,
        rewrite: (path) => path.replace(/^\/estradeck/, ""),
      },
      "/estradeck": "http://127.0.0.1:5173",
    },
  },
})

export default config
