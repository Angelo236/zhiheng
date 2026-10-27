const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zhiheng", {
  getConfig: () => ipcRenderer.invoke("config"),
  saveKey: (apiKey) => ipcRenderer.invoke("save-key", apiKey),
  notify: (title, body) => ipcRenderer.send("notify", title, body),
});
