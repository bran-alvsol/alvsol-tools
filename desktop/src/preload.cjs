const { contextBridge, ipcRenderer } = require("electron");

const api = {
  isDesktop: true,
  app: Object.freeze({
    info: () => ipcRenderer.invoke("app:info")
  }),
  storage: Object.freeze({
    getJson: (key) => ipcRenderer.invoke("storage:get", key),
    setJson: (key, valueJson) => ipcRenderer.invoke("storage:set", key, valueJson),
    remove: (key) => ipcRenderer.invoke("storage:remove", key)
  })
};

if (!location.pathname.startsWith("/tools/")) {
  Object.assign(api, {
    tools: Object.freeze({
      list: () => ipcRenderer.invoke("tools:list"),
      open: (toolId) => ipcRenderer.invoke("tools:open", toolId),
      onChanged: (callback) => {
        const handler = () => callback();
        ipcRenderer.on("tools:changed", handler);
        return () => ipcRenderer.removeListener("tools:changed", handler);
      }
    }),
    backups: Object.freeze({
      create: () => ipcRenderer.invoke("backups:create"),
      list: () => ipcRenderer.invoke("backups:list"),
      settings: () => ipcRenderer.invoke("backups:settings"),
      chooseFolder: () => ipcRenderer.invoke("backups:choose-folder"),
      restoreSelect: () => ipcRenderer.invoke("backups:restore-select")
    }),
    sync: Object.freeze({
      status: () => ipcRenderer.invoke("sync:status"),
      chooseFolder: () => ipcRenderer.invoke("sync:choose-folder"),
      publish: () => ipcRenderer.invoke("sync:publish"),
      apply: (snapshotId) => ipcRenderer.invoke("sync:apply", snapshotId),
      onChanged: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on("sync:changed", handler);
        return () => ipcRenderer.removeListener("sync:changed", handler);
      }
    }),
    updates: Object.freeze({
      selectPackage: () => ipcRenderer.invoke("updates:select-package"),
      install: (details) => ipcRenderer.invoke("updates:install", details)
    }),
    activity: Object.freeze({
      list: (limit = 20) => ipcRenderer.invoke("activity:list", limit)
    })
  });
}

contextBridge.exposeInMainWorld("alvsolDesktop", Object.freeze(api));
