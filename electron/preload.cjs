const { contextBridge } = require("electron")

contextBridge.exposeInMainWorld("codexExplorer", {
  platform: process.platform,
})
