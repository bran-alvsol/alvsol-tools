const desktop = window.alvsolDesktop;
const elements = {
  navButtons: [...document.querySelectorAll(".nav-button")],
  views: [...document.querySelectorAll(".view")],
  toolList: document.querySelector("#toolList"),
  toolCount: document.querySelector("#toolCount"),
  nativeCount: document.querySelector("#nativeCount"),
  backupList: document.querySelector("#backupList"),
  backupFolder: document.querySelector("#backupFolder"),
  createBackupButton: document.querySelector("#createBackupButton"),
  chooseBackupFolderButton: document.querySelector("#chooseBackupFolderButton"),
  restoreBackupButton: document.querySelector("#restoreBackupButton"),
  syncPill: document.querySelector("#syncPill"),
  syncFolder: document.querySelector("#syncFolder"),
  syncStatusText: document.querySelector("#syncStatusText"),
  syncDetail: document.querySelector("#syncDetail"),
  chooseSyncFolderButton: document.querySelector("#chooseSyncFolderButton"),
  checkSyncButton: document.querySelector("#checkSyncButton"),
  publishSyncButton: document.querySelector("#publishSyncButton"),
  applySyncButton: document.querySelector("#applySyncButton"),
  selectPackageButton: document.querySelector("#selectPackageButton"),
  updateForm: document.querySelector("#updateForm"),
  packagePath: document.querySelector("#packagePath"),
  toolId: document.querySelector("#toolId"),
  toolVersion: document.querySelector("#toolVersion"),
  toolName: document.querySelector("#toolName"),
  toolDescription: document.querySelector("#toolDescription"),
  updateStatus: document.querySelector("#updateStatus"),
  activityList: document.querySelector("#activityList"),
  toast: document.querySelector("#toast")
};

let currentSyncStatus = null;
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-GT", { dateStyle: "medium", timeStyle: "short" });
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function notify(message, type = "ok") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show${type === "error" ? " error" : ""}`;
  toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 4200);
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function showView(viewName) {
  elements.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  elements.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  if (viewName === "backups") loadBackups();
  if (viewName === "sync") refreshSync();
  if (viewName === "updates") loadActivity();
}

async function loadTools() {
  const tools = await desktop.tools.list();
  elements.toolCount.textContent = tools.length;
  elements.nativeCount.textContent = tools.filter((tool) => tool.storageMode === "native").length;
  elements.toolList.innerHTML = tools.length ? tools.map((tool) => `
    <article class="tool-row">
      <div class="tool-copy">
        <strong>${escapeHtml(tool.name)}</strong>
        <span>${escapeHtml(tool.description)}</span>
      </div>
      <div class="tool-meta">
        <span>Versión <b>${escapeHtml(tool.version)}</b></span>
        <span>${escapeHtml(tool.storageLabel)}</span>
      </div>
      <button class="primary-button open-tool" data-tool-id="${escapeHtml(tool.id)}">Abrir</button>
    </article>
  `).join("") : '<div class="empty-row">No hay herramientas instaladas.</div>';
  document.querySelectorAll(".open-tool").forEach((button) => {
    button.addEventListener("click", async () => {
      setBusy(button, true);
      try { await desktop.tools.open(button.dataset.toolId); }
      catch (error) { notify(error.message, "error"); }
      finally { setBusy(button, false); }
    });
  });
}

async function loadBackups() {
  const [settings, backups] = await Promise.all([desktop.backups.settings(), desktop.backups.list()]);
  elements.backupFolder.textContent = settings.externalFolder || "No configurada";
  elements.backupList.innerHTML = backups.length ? backups.map((backup) => `
    <div class="data-row">
      <div><strong>${escapeHtml(backup.name)}</strong><span>${formatDate(backup.createdAt)}</span></div>
      <span>${formatBytes(backup.size)}</span>
    </div>
  `).join("") : '<div class="empty-row">Todavía no hay respaldos.</div>';
}

function syncPresentation(status) {
  const presentations = {
    "not-configured": ["Sin configurar", "Selecciona una carpeta compartida", "", ""],
    "folder-unavailable": ["No disponible", "La carpeta compartida no está disponible", "Revisa OneDrive o la conexión.", "error"],
    "local-pending": ["Pendiente", "Hay cambios locales por compartir", "La copia principal continúa segura en esta computadora.", "warn"],
    "up-to-date": ["Actualizado", "Las copias están actualizadas", status.latest ? `Última copia: ${formatDate(status.latest.createdAt)}` : "Aún no se ha creado la primera copia.", "ok"],
    "remote-available": ["Disponible", "Hay una copia más reciente", `Creada: ${formatDate(status.latest?.createdAt)}`, "warn"],
    "conflict": ["Revisión necesaria", "Las dos computadoras tienen cambios diferentes", "No se reemplazará información automáticamente.", "error"]
  };
  return presentations[status.status] || presentations["not-configured"];
}

async function refreshSync(status = null) {
  currentSyncStatus = status || await desktop.sync.status();
  const [pill, title, detail, type] = syncPresentation(currentSyncStatus);
  elements.syncFolder.textContent = currentSyncStatus.syncFolder || "No configurada";
  elements.syncPill.textContent = pill;
  elements.syncPill.className = `pill${type ? ` ${type}` : ""}`;
  elements.syncStatusText.textContent = title;
  elements.syncDetail.textContent = detail;
  const canPublish = currentSyncStatus.configured && currentSyncStatus.status !== "folder-unavailable";
  elements.publishSyncButton.disabled = !canPublish;
  elements.applySyncButton.classList.toggle("hidden", currentSyncStatus.status !== "remote-available");
}

async function loadActivity() {
  const activity = await desktop.activity.list(20);
  const labels = {
    "backup-created": "Respaldo creado",
    "backup-restored": "Respaldo restaurado",
    "sync-published": "Copia compartida",
    "sync-applied": "Copia sincronizada",
    "tool-installed": "Herramienta instalada"
  };
  elements.activityList.innerHTML = activity.length ? activity.map((item) => `
    <div class="data-row">
      <div><strong>${escapeHtml(labels[item.eventType] || item.eventType)}</strong><span>${escapeHtml(item.detail)}</span></div>
      <span>${formatDate(item.createdAt)}</span>
    </div>
  `).join("") : '<div class="empty-row">Todavía no hay actividad registrada.</div>';
}

elements.navButtons.forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

elements.createBackupButton.addEventListener("click", async () => {
  setBusy(elements.createBackupButton, true);
  try { await desktop.backups.create(); await loadBackups(); notify("Respaldo creado correctamente."); }
  catch (error) { notify(error.message, "error"); }
  finally { setBusy(elements.createBackupButton, false); }
});

elements.chooseBackupFolderButton.addEventListener("click", async () => {
  try { const folder = await desktop.backups.chooseFolder(); if (folder) { await loadBackups(); notify("Carpeta de respaldo configurada."); } }
  catch (error) { notify(error.message, "error"); }
});

elements.restoreBackupButton.addEventListener("click", async () => {
  if (!confirm("Se cerrarán las herramientas abiertas y se reemplazará la información actual. ¿Continuar?")) return;
  try { const restored = await desktop.backups.restoreSelect(); if (restored) { await Promise.all([loadTools(), loadBackups()]); notify("Respaldo restaurado."); } }
  catch (error) { notify(error.message, "error"); }
});

elements.chooseSyncFolderButton.addEventListener("click", async () => {
  try { const status = await desktop.sync.chooseFolder(); if (status) { await refreshSync(status); notify("Carpeta compartida configurada."); } }
  catch (error) { notify(error.message, "error"); }
});

elements.checkSyncButton.addEventListener("click", async () => {
  try { await refreshSync(); notify("Estado de sincronización actualizado."); }
  catch (error) { notify(error.message, "error"); }
});

elements.publishSyncButton.addEventListener("click", async () => {
  setBusy(elements.publishSyncButton, true);
  try { await refreshSync(await desktop.sync.publish()); notify("Copia compartida correctamente."); }
  catch (error) { notify(error.message, "error"); }
  finally { setBusy(elements.publishSyncButton, false); }
});

elements.applySyncButton.addEventListener("click", async () => {
  if (!currentSyncStatus?.latest?.snapshotId) return;
  if (!confirm("Se creará un respaldo local y después se aplicará la copia compartida. ¿Continuar?")) return;
  setBusy(elements.applySyncButton, true);
  try { await refreshSync(await desktop.sync.apply(currentSyncStatus.latest.snapshotId)); await loadTools(); notify("Copia compartida aplicada."); }
  catch (error) { notify(error.message, "error"); }
  finally { setBusy(elements.applySyncButton, false); }
});

elements.selectPackageButton.addEventListener("click", async () => {
  try {
    const selected = await desktop.updates.selectPackage();
    if (!selected) return;
    elements.packagePath.value = selected.packagePath;
    elements.toolId.value = selected.id;
    elements.toolVersion.value = selected.version;
    elements.toolName.value = selected.name;
    elements.updateStatus.textContent = selected.packageName;
  } catch (error) { notify(error.message, "error"); }
});

elements.updateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.updateForm.querySelector('button[type="submit"]');
  if (!elements.packagePath.value) { notify("Selecciona primero un archivo HTML o ZIP.", "error"); return; }
  setBusy(submitButton, true);
  elements.updateStatus.textContent = "Preparando actualización...";
  try {
    const result = await desktop.updates.install({
      packagePath: elements.packagePath.value,
      id: elements.toolId.value,
      version: elements.toolVersion.value,
      name: elements.toolName.value,
      description: elements.toolDescription.value
    });
    elements.updateStatus.textContent = `${result.name} V${result.version} instalada`;
    await Promise.all([loadTools(), loadActivity()]);
    notify(result.updated ? "Herramienta actualizada." : "Herramienta agregada.");
  } catch (error) {
    elements.updateStatus.textContent = error.message;
    notify(error.message, "error");
  } finally { setBusy(submitButton, false); }
});

desktop.tools.onChanged(() => loadTools().catch(() => {}));
desktop.sync.onChanged((status) => refreshSync(status).catch(() => {}));

Promise.all([loadTools(), refreshSync()]).catch((error) => notify(error.message, "error"));
