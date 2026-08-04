const { app, BrowserWindow, dialog, ipcMain, net, protocol, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const AdmZip = require("adm-zip");
const LocalDatabase = require("./local-database.cjs");
const ConfigStore = require("./config-store.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "alvsol",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

if (process.env.ALVSOL_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.ALVSOL_USER_DATA_DIR));
}

const TOOL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_FILES = 1500;
const BACKUP_LIMIT = 30;

let mainWindow = null;
let localDatabase = null;
let configStore = null;
let userDataRoot = "";
let localBackupRoot = "";
let userToolsRoot = "";
let updateBackupRoot = "";
let quitting = false;
let syncPublishTimer = null;

const toolWindows = new Map();
const toolContexts = new Map();

function isPackaged() {
  return app.isPackaged;
}

function repositoryRoot() {
  return path.resolve(__dirname, "..", "..");
}

function bundledPortalRoot() {
  return isPackaged()
    ? path.join(process.resourcesPath, "portal")
    : repositoryRoot();
}

function bundledToolsRoot() {
  return path.join(bundledPortalRoot(), "tools");
}

function bundledAssetsRoot() {
  return path.join(bundledPortalRoot(), "assets");
}

function rendererRoot() {
  return path.join(__dirname, "renderer");
}

function bundledManifestPath() {
  return path.join(__dirname, "..", "resources", "bundled-tools.json");
}

function readBundledTools() {
  return JSON.parse(fs.readFileSync(bundledManifestPath(), "utf8"));
}

function safeChildPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (candidate !== resolvedRoot && !candidate.startsWith(prefix)) {
    throw new Error("Ruta fuera del área permitida.");
  }
  return candidate;
}

function sanitizeToolId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!TOOL_ID_PATTERN.test(id)) throw new Error("El identificador de la herramienta no es válido.");
  return id;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.copyFileSync(temporary, filePath);
  fs.unlinkSync(temporary);
}

function listTools() {
  const bundled = readBundledTools().map((tool) => ({
    ...tool,
    source: "bundled",
    storageLabel: tool.storageMode === "native" ? "Base local protegida" : "Modo de compatibilidad"
  }));
  const installed = localDatabase.listInstalledTools()
    .filter((tool) => fs.existsSync(safeChildPath(userToolsRoot, tool.id)))
    .map((tool) => ({
      ...tool,
      source: "installed",
      storageMode: "compatibility",
      storageLabel: "Modo de compatibilidad"
    }));
  const merged = new Map(bundled.map((tool) => [tool.id, tool]));
  for (const tool of installed) merged.set(tool.id, tool);
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function findTool(toolId) {
  return listTools().find((tool) => tool.id === toolId) || null;
}

function toolDirectory(toolId) {
  const installed = safeChildPath(userToolsRoot, toolId);
  if (fs.existsSync(installed)) return installed;
  return safeChildPath(bundledToolsRoot(), toolId);
}

function resolveProtocolFile(urlText) {
  const url = new URL(urlText);
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return path.join(rendererRoot(), "index.html");

  const area = parts.shift();
  let filePath;
  if (area === "ui") {
    filePath = safeChildPath(rendererRoot(), ...parts);
  } else if (area === "assets") {
    filePath = safeChildPath(bundledAssetsRoot(), ...parts);
  } else if (area === "tools") {
    const toolId = sanitizeToolId(parts.shift());
    filePath = safeChildPath(toolDirectory(toolId), ...parts);
  } else {
    return null;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : null;
}

async function registerLocalProtocol() {
  protocol.handle("alvsol", async (request) => {
    try {
      const filePath = resolveProtocolFile(request.url);
      if (!filePath) return new Response("No encontrado", { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Solicitud no válida", { status: 400 });
    }
  });
}

function secureWindowOptions(additional = {}) {
  return {
    backgroundColor: "#f3f5f6",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    },
    ...additional
  };
}

function protectWindow(window, toolId = null) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (target.protocol !== "alvsol:") {
      event.preventDefault();
      return;
    }
    if (toolId && (target.pathname === "/" || target.pathname === "/index.html")) {
      event.preventDefault();
      window.close();
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow(secureWindowOptions({
    width: 1220,
    height: 780,
    minWidth: 920,
    minHeight: 620,
    title: "ALVSOL Tools"
  }));
  protectWindow(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL("alvsol://app/ui/index.html");
}

function openTool(toolIdValue) {
  const toolId = sanitizeToolId(toolIdValue);
  const tool = findTool(toolId);
  if (!tool) throw new Error("La herramienta no está registrada.");

  const existing = toolWindows.get(toolId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return true;
  }

  const window = new BrowserWindow(secureWindowOptions({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: tool.name
  }));
  toolWindows.set(toolId, window);
  const webContentsId = window.webContents.id;
  toolContexts.set(webContentsId, toolId);
  protectWindow(window, toolId);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    toolContexts.delete(webContentsId);
    toolWindows.delete(toolId);
  });
  const entry = String(tool.entry || "index.html").replace(/\\/g, "/");
  window.loadURL(`alvsol://app/tools/${toolId}/${entry}`);
  return true;
}

function closeToolWindows() {
  for (const window of toolWindows.values()) {
    if (!window.isDestroyed()) window.destroy();
  }
  toolWindows.clear();
  toolContexts.clear();
}

function toolIdForEvent(event) {
  const toolId = toolContexts.get(event.sender.id);
  if (!toolId) throw new Error("Esta operación solo está disponible dentro de una herramienta.");
  return toolId;
}

function requireDashboard(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Esta operación solo está disponible en el panel principal.");
  }
}

async function createDatabaseBackup(destinationRoot = localBackupRoot, prefix = "ALVSOL-Tools") {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const stamp = timestampForFile();
  const databaseName = `${prefix}-${stamp}.db`;
  const databasePath = path.join(destinationRoot, databaseName);
  await localDatabase.backup(databasePath);
  const manifest = {
    format: "alvsol-tools-backup-v1",
    createdAt: new Date().toISOString(),
    deviceId: configStore.get("deviceId"),
    databaseFile: databaseName,
    sha256: sha256(databasePath),
    appVersion: app.getVersion()
  };
  atomicWriteJson(`${databasePath}.json`, manifest);
  localDatabase.log("backup-created", databasePath);
  return { ...manifest, databasePath, manifestPath: `${databasePath}.json` };
}

function rotateLocalBackups() {
  if (!fs.existsSync(localBackupRoot)) return;
  const files = fs.readdirSync(localBackupRoot)
    .filter((name) => /^ALVSOL-Tools-.*\.db$/.test(name))
    .map((name) => ({ name, fullPath: path.join(localBackupRoot, name), mtime: fs.statSync(path.join(localBackupRoot, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(BACKUP_LIMIT)) {
    fs.unlinkSync(file.fullPath);
    const manifest = `${file.fullPath}.json`;
    if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
  }
}

async function createAllBackups() {
  const local = await createDatabaseBackup();
  rotateLocalBackups();
  const externalRoot = configStore.get("backupFolder", "");
  let external = null;
  if (externalRoot && fs.existsSync(externalRoot)) {
    external = await createDatabaseBackup(externalRoot);
  }
  return { local, external };
}

function listBackups() {
  if (!fs.existsSync(localBackupRoot)) return [];
  return fs.readdirSync(localBackupRoot)
    .filter((name) => /^ALVSOL-Tools-.*\.db$/.test(name))
    .map((name) => {
      const fullPath = path.join(localBackupRoot, name);
      const stats = fs.statSync(fullPath);
      return { name, fullPath, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function restoreDatabase(sourcePath) {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== ".db") {
    throw new Error("Selecciona un respaldo válido de ALVSOL Tools.");
  }
  closeToolWindows();
  await createDatabaseBackup(localBackupRoot, "ALVSOL-Tools-antes-restaurar");
  localDatabase.replaceWith(resolved);
  configStore.merge({ localDirty: true, lastRestoreAt: new Date().toISOString() });
  localDatabase.log("backup-restored", resolved);
  return true;
}

function newestSyncManifests(syncFolder) {
  if (!syncFolder || !fs.existsSync(syncFolder)) return [];
  return fs.readdirSync(syncFolder)
    .filter((name) => /^ALVSOL-SYNC-.*\.json$/.test(name))
    .map((name) => {
      try {
        const manifestPath = path.join(syncFolder, name);
        const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const databasePath = path.join(syncFolder, value.databaseFile || "");
        if (value.format !== "alvsol-tools-sync-v1" || !fs.existsSync(databasePath)) return null;
        if (sha256(databasePath) !== value.sha256) return null;
        return { ...value, manifestPath, databasePath };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function isDescendant(manifest, ancestorId, manifests) {
  if (!ancestorId) return true;
  const byId = new Map(manifests.map((item) => [item.snapshotId, item]));
  let current = manifest;
  const visited = new Set();
  while (current && !visited.has(current.snapshotId)) {
    if (current.snapshotId === ancestorId) return true;
    visited.add(current.snapshotId);
    current = byId.get(current.parentSnapshotId);
  }
  return false;
}

function syncStatus() {
  const syncFolder = configStore.get("syncFolder", "");
  if (!syncFolder) return { configured: false, status: "not-configured" };
  if (!fs.existsSync(syncFolder)) return { configured: true, status: "folder-unavailable", syncFolder };
  const manifests = newestSyncManifests(syncFolder);
  const latest = manifests[0] || null;
  const lastAppliedSnapshotId = configStore.get("lastAppliedSnapshotId", "");
  const localDirty = Boolean(configStore.get("localDirty", false));
  if (!latest || latest.snapshotId === lastAppliedSnapshotId) {
    return { configured: true, status: localDirty ? "local-pending" : "up-to-date", syncFolder, latest };
  }
  if (localDirty || (lastAppliedSnapshotId && !isDescendant(latest, lastAppliedSnapshotId, manifests))) {
    return { configured: true, status: "conflict", syncFolder, latest };
  }
  return { configured: true, status: "remote-available", syncFolder, latest };
}

async function publishSyncSnapshot() {
  clearTimeout(syncPublishTimer);
  syncPublishTimer = null;
  const syncFolder = configStore.get("syncFolder", "");
  if (!syncFolder || !fs.existsSync(syncFolder)) return syncStatus();
  if (!configStore.get("localDirty", false)) return syncStatus();

  const snapshotId = crypto.randomUUID();
  const stamp = timestampForFile();
  const databaseName = `ALVSOL-SYNC-${stamp}-${snapshotId}.db`;
  const databasePath = path.join(syncFolder, databaseName);
  await localDatabase.backup(databasePath);
  const manifest = {
    format: "alvsol-tools-sync-v1",
    snapshotId,
    parentSnapshotId: configStore.get("lastAppliedSnapshotId", "") || null,
    deviceId: configStore.get("deviceId"),
    createdAt: new Date().toISOString(),
    databaseFile: databaseName,
    sha256: sha256(databasePath),
    appVersion: app.getVersion()
  };
  atomicWriteJson(path.join(syncFolder, `ALVSOL-SYNC-${stamp}-${snapshotId}.json`), manifest);
  configStore.merge({
    lastAppliedSnapshotId: snapshotId,
    lastSyncAt: manifest.createdAt,
    localDirty: false
  });
  localDatabase.log("sync-published", snapshotId);
  mainWindow?.webContents.send("sync:changed", syncStatus());
  return syncStatus();
}

async function applySyncSnapshot(snapshotId) {
  const currentStatus = syncStatus();
  if (currentStatus.status === "conflict") {
    throw new Error("Hay cambios diferentes en las dos computadoras. No se reemplazará información automáticamente.");
  }
  const manifests = newestSyncManifests(configStore.get("syncFolder", ""));
  const selected = manifests.find((manifest) => manifest.snapshotId === snapshotId);
  if (!selected) throw new Error("No se encontró la copia compartida seleccionada.");
  closeToolWindows();
  await createDatabaseBackup(localBackupRoot, "ALVSOL-Tools-antes-sincronizar");
  localDatabase.replaceWith(selected.databasePath);
  configStore.merge({
    lastAppliedSnapshotId: selected.snapshotId,
    lastSyncAt: new Date().toISOString(),
    localDirty: false
  });
  localDatabase.log("sync-applied", selected.snapshotId);
  mainWindow?.webContents.send("tools:changed");
  return syncStatus();
}

function markLocalChange() {
  configStore.set("localDirty", true);
  const syncFolder = configStore.get("syncFolder", "");
  if (syncFolder && fs.existsSync(syncFolder)) {
    clearTimeout(syncPublishTimer);
    syncPublishTimer = setTimeout(() => publishSyncSnapshot().catch(() => {}), 15000);
  }
}

function suggestFromPackage(packagePath) {
  const base = path.basename(packagePath, path.extname(packagePath));
  const versionMatch = base.match(/(?:^|[^a-z0-9])v(?:ersion)?[\s_-]*(\d+(?:[._-]\d+)+)/i);
  const version = versionMatch ? versionMatch[1].replace(/[_-]/g, ".") : "";
  const rawName = base.replace(/(?:^|[^a-z0-9])v(?:ersion)?[\s_-]*\d+(?:[._-]\d+)+/i, " ");
  const name = rawName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const id = `herramienta-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    .replace(/^herramienta-herramienta-/, "herramienta-");
  return { packagePath, packageName: path.basename(packagePath), name, version, id };
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function findHtmlFiles(root) {
  const results = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) results.push(fullPath);
    }
  };
  visit(root);
  return results.sort((a, b) => {
    const aIndex = path.basename(a).toLowerCase() === "index.html" ? 0 : 1;
    const bIndex = path.basename(b).toLowerCase() === "index.html" ? 0 : 1;
    return aIndex - bIndex || a.length - b.length;
  });
}

function backupToolFolder(toolId) {
  const source = toolDirectory(toolId);
  if (!fs.existsSync(source)) return null;
  fs.mkdirSync(updateBackupRoot, { recursive: true });
  const destination = path.join(updateBackupRoot, `${toolId}-${timestampForFile()}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(source);
  zip.writeZip(destination);
  return destination;
}

function installToolPackage(details) {
  const toolId = sanitizeToolId(details.id);
  const name = String(details.name || "").trim();
  const description = String(details.description || "").trim();
  const version = String(details.version || "").trim();
  const packagePath = path.resolve(String(details.packagePath || ""));
  if (!name || !version) throw new Error("Indica el nombre y la versión de la herramienta.");
  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) throw new Error("No se encontró el archivo seleccionado.");
  if (fs.statSync(packagePath).size > MAX_PACKAGE_BYTES) throw new Error("El archivo es demasiado grande.");
  const extension = path.extname(packagePath).toLowerCase();
  if (![".html", ".htm", ".zip"].includes(extension)) throw new Error("La actualización debe ser HTML o ZIP.");

  const workRoot = path.join(userDataRoot, "update-work", crypto.randomUUID());
  const extractRoot = path.join(workRoot, "extract");
  const stagingRoot = path.join(workRoot, "staging");
  fs.mkdirSync(extractRoot, { recursive: true });
  try {
    if (extension === ".zip") {
      const zip = new AdmZip(packagePath);
      const entries = zip.getEntries();
      if (!entries.length || entries.length > MAX_ZIP_FILES) throw new Error("El ZIP está vacío o contiene demasiados archivos.");
      let extractedBytes = 0;
      for (const entry of entries) {
        const normalized = entry.entryName.replace(/\\/g, "/");
        if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
          throw new Error("El ZIP contiene una ruta no permitida.");
        }
        if (entry.header.size > MAX_PACKAGE_BYTES) throw new Error("El ZIP contiene un archivo demasiado grande.");
        extractedBytes += Number(entry.header.size) || 0;
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("El contenido extraído del ZIP es demasiado grande.");
      }
      zip.extractAllTo(extractRoot, true);
    } else {
      fs.copyFileSync(packagePath, path.join(extractRoot, path.basename(packagePath)));
    }

    const htmlFiles = findHtmlFiles(extractRoot);
    if (!htmlFiles.length) throw new Error("El archivo no contiene una página HTML.");
    const mainHtml = htmlFiles[0];
    const sourceRoot = path.dirname(mainHtml);
    copyDirectory(sourceRoot, stagingRoot);
    if (path.basename(mainHtml).toLowerCase() !== "index.html") {
      const stagedMain = path.join(stagingRoot, path.basename(mainHtml));
      fs.copyFileSync(stagedMain, path.join(stagingRoot, "index.html"));
    }

    closeToolWindows();
    const existing = findTool(toolId);
    if (existing) backupToolFolder(toolId);
    const destination = safeChildPath(userToolsRoot, toolId);
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(stagingRoot, destination);
    localDatabase.upsertInstalledTool({
      id: toolId,
      name,
      description,
      version,
      entry: "index.html",
      packageName: path.basename(packagePath)
    });
    markLocalChange();
    mainWindow?.webContents.send("tools:changed");
    return { id: toolId, name, description, version, updated: Boolean(existing) };
  } finally {
    if (fs.existsSync(workRoot)) fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function registerIpcHandlers() {
  ipcMain.handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataFolder: userDataRoot,
    deviceId: configStore.get("deviceId")
  }));
  ipcMain.handle("tools:list", (event) => { requireDashboard(event); return listTools(); });
  ipcMain.handle("tools:open", (event, toolId) => { requireDashboard(event); return openTool(toolId); });
  ipcMain.handle("activity:list", (event, limit) => { requireDashboard(event); return localDatabase.recentActivity(limit); });

  ipcMain.handle("storage:get", (event, key) => localDatabase.getToolState(toolIdForEvent(event), String(key)));
  ipcMain.handle("storage:set", (event, key, valueJson) => {
    const result = localDatabase.setToolState(toolIdForEvent(event), String(key), String(valueJson));
    markLocalChange();
    return result;
  });
  ipcMain.handle("storage:remove", (event, key) => {
    const result = localDatabase.removeToolState(toolIdForEvent(event), String(key));
    markLocalChange();
    return result;
  });

  ipcMain.handle("backups:create", (event) => { requireDashboard(event); return createAllBackups(); });
  ipcMain.handle("backups:list", (event) => { requireDashboard(event); return listBackups(); });
  ipcMain.handle("backups:choose-folder", async (event) => {
    requireDashboard(event);
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    configStore.set("backupFolder", result.filePaths[0]);
    return result.filePaths[0];
  });
  ipcMain.handle("backups:settings", (event) => {
    requireDashboard(event);
    return { localFolder: localBackupRoot, externalFolder: configStore.get("backupFolder", "") };
  });
  ipcMain.handle("backups:restore-select", async (event) => {
    requireDashboard(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: localBackupRoot,
      properties: ["openFile"],
      filters: [{ name: "Respaldo ALVSOL Tools", extensions: ["db"] }]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    return restoreDatabase(result.filePaths[0]);
  });

  ipcMain.handle("sync:status", (event) => { requireDashboard(event); return syncStatus(); });
  ipcMain.handle("sync:choose-folder", async (event) => {
    requireDashboard(event);
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    configStore.set("syncFolder", result.filePaths[0]);
    return syncStatus();
  });
  ipcMain.handle("sync:publish", (event) => { requireDashboard(event); return publishSyncSnapshot(); });
  ipcMain.handle("sync:apply", (event, snapshotId) => {
    requireDashboard(event);
    return applySyncSnapshot(String(snapshotId || ""));
  });

  ipcMain.handle("updates:select-package", async (event) => {
    requireDashboard(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Herramientas ALVSOL", extensions: ["html", "htm", "zip"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return suggestFromPackage(result.filePaths[0]);
  });
  ipcMain.handle("updates:install", (event, details) => {
    requireDashboard(event);
    return installToolPackage(details || {});
  });
}

async function initialize() {
  userDataRoot = app.getPath("userData");
  localBackupRoot = path.join(userDataRoot, "backups");
  userToolsRoot = path.join(userDataRoot, "tools");
  updateBackupRoot = path.join(userDataRoot, "tool-version-backups");
  fs.mkdirSync(userToolsRoot, { recursive: true });
  configStore = new ConfigStore(path.join(userDataRoot, "desktop-config.json"));
  localDatabase = await LocalDatabase.create(path.join(userDataRoot, "data", "alvsol-tools.db"));
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );
  await registerLocalProtocol();
  registerIpcHandlers();
  createMainWindow();
  setTimeout(() => mainWindow?.webContents.send("sync:changed", syncStatus()), 1200);
  setInterval(() => createDatabaseBackup().then(rotateLocalBackups).catch(() => {}), 15 * 60 * 1000).unref();
}

app.whenReady().then(initialize);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitting || !localDatabase) return;
  event.preventDefault();
  quitting = true;
  clearTimeout(syncPublishTimer);
  closeToolWindows();
  Promise.resolve()
    .then(() => publishSyncSnapshot().catch(() => null))
    .then(() => createDatabaseBackup().catch(() => null))
    .finally(() => {
      localDatabase.close();
      app.quit();
    });
});
