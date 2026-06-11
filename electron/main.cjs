const { app, BrowserWindow, dialog, shell } = require("electron")
const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { Readable } = require("node:stream")

const DEV_SERVER_URL = process.env.ELECTRON_START_URL || "http://localhost:3010"

let mainWindow
let embeddedServer

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, "..")
}

function getStaticPath(requestPath) {
  let pathname
  try {
    pathname = decodeURIComponent(
      new URL(requestPath, "http://localhost").pathname
    )
  } catch {
    return null
  }

  if (pathname === "/") return null

  const clientDir = path.join(getAppRoot(), "dist", "client")
  const requestedPath = path.normalize(path.join(clientDir, pathname))
  const relativePath = path.relative(clientDir, requestedPath)

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath))
    return null
  return requestedPath
}

function sendStaticFile(req, res) {
  const filePath = getStaticPath(req.url || "/")
  if (!filePath) return false

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false

    const headers = {
      "Content-Length": stat.size,
      "Content-Type":
        mimeTypes[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream",
    }
    res.writeHead(200, headers)

    if (req.method === "HEAD") {
      res.end()
      return true
    }

    fs.createReadStream(filePath).pipe(res)
    return true
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Unable to read asset")
      return true
    }
    return false
  }
}

function copyHeaders(headers) {
  const copied = {}
  headers.forEach((value, key) => {
    copied[key] = value
  })

  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie()
    if (cookies.length > 0) copied["set-cookie"] = cookies
  }

  return copied
}

async function handleStartRequest(fetchHandler, origin, req, res) {
  const requestUrl = new URL(req.url || "/", origin)
  const headers = new Headers()

  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }

  const init = {
    method: req.method || "GET",
    headers,
  }

  if (init.method !== "GET" && init.method !== "HEAD") {
    init.body = Readable.toWeb(req)
    init.duplex = "half"
  }

  const response = await fetchHandler(new Request(requestUrl, init))
  res.writeHead(
    response.status,
    response.statusText,
    copyHeaders(response.headers)
  )

  if (!response.body || init.method === "HEAD") {
    res.end()
    return
  }

  Readable.fromWeb(response.body).pipe(res)
}

async function startEmbeddedServer() {
  const appRoot = getAppRoot()
  const serverEntry = path.join(appRoot, "dist", "server", "server.js")
  const serverModule = await import(pathToFileURL(serverEntry).href)
  const fetchHandler = serverModule.default && serverModule.default.fetch

  if (typeof fetchHandler !== "function") {
    throw new Error(`No TanStack Start fetch handler found in ${serverEntry}`)
  }

  embeddedServer = http.createServer((req, res) => {
    if (sendStaticFile(req, res)) return

    const address = embeddedServer.address()
    const port = typeof address === "object" && address ? address.port : 0
    const origin = `http://127.0.0.1:${port}`

    handleStartRequest(fetchHandler, origin, req, res).catch((error) => {
      console.error(error)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      }
      res.end("Application server failed")
    })
  })

  await new Promise((resolve, reject) => {
    embeddedServer.once("error", reject)
    embeddedServer.listen(0, "127.0.0.1", resolve)
  })

  const address = embeddedServer.address()
  if (!address || typeof address !== "object") {
    throw new Error("Unable to start local application server")
  }

  return `http://127.0.0.1:${address.port}`
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Codex Explorer",
    backgroundColor: "#f8f6f1",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  const url = app.isPackaged ? await startEmbeddedServer() : DEV_SERVER_URL
  await mainWindow.loadURL(url)

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" })
  }
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(createWindow)
    .catch((error) => {
      console.error(error)
      dialog.showErrorBox("Codex Explorer failed to start", error.message)
      app.quit()
    })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error(error)
      dialog.showErrorBox("Codex Explorer failed to start", error.message)
    })
  }
})

app.on("before-quit", () => {
  if (embeddedServer) embeddedServer.close()
})
