const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

const desktopRoot = path.resolve(__dirname, "..");
const cacheRoot = path.join(desktopRoot, ".cache", "desktop-smoke");
const userDataRoot = path.join(cacheRoot, "user-data");
const syncRoot = path.join(cacheRoot, "sync");
const externalBackupRoot = path.join(cacheRoot, "external-backups");
const testToolPath = path.join(cacheRoot, "herramienta-prueba-v1.0.html");
const port = 9333;

function waitForDebugger(timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryRequest = () => {
      const request = http.get(`http://127.0.0.1:${port}/json/version`, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        setTimeout(tryRequest, 200);
      });
      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) return reject(new Error("Electron no abrió el puerto de prueba."));
        setTimeout(tryRequest, 200);
      });
    };
    tryRequest();
  });
}

async function main() {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.mkdirSync(syncRoot, { recursive: true });
  fs.mkdirSync(externalBackupRoot, { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, "desktop-config.json"), JSON.stringify({
    syncFolder: syncRoot,
    backupFolder: externalBackupRoot
  }), "utf8");
  fs.writeFileSync(testToolPath, "<!doctype html><html><head><meta charset=\"utf-8\"><title>Prueba</title></head><body><h1>Herramienta de prueba</h1></body></html>", "utf8");

  const packagedExecutable = process.env.ALVSOL_SMOKE_EXECUTABLE;
  const executablePath = packagedExecutable || require("electron");
  const executableArguments = packagedExecutable
    ? [`--remote-debugging-port=${port}`]
    : [desktopRoot, `--remote-debugging-port=${port}`];
  const child = spawn(executablePath, executableArguments, {
    cwd: desktopRoot,
    env: { ...process.env, ALVSOL_USER_DATA_DIR: userDataRoot },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  let browser;
  try {
    await waitForDebugger();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const pageErrors = [];
    const externalRequests = [];
    context.on("page", (childPage) => childPage.on("pageerror", (error) => pageErrors.push(error.message)));
    context.on("request", (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });
    const page = context.pages().find((candidate) => candidate.url().includes("/ui/index.html"));
    assert.ok(page, "No se encontró el panel principal.");
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForSelector(".tool-row");
    assert.equal(await page.locator(".tool-row").count(), 4);
    await page.screenshot({ path: path.join(cacheRoot, "dashboard.png") });

    await page.locator('[data-view="backups"]').click();
    await page.locator("#createBackupButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#backupList .data-row").length > 0);
    assert.ok(fs.readdirSync(path.join(userDataRoot, "backups")).some((name) => name.endsWith(".db")));
    assert.ok(fs.readdirSync(externalBackupRoot).some((name) => name.endsWith(".db")));

    const nativeResult = await page.evaluate(async (packagePath) => {
      const tool = await window.alvsolDesktop.updates.install({
        packagePath,
        id: "herramienta-prueba",
        version: "1.0",
        name: "HERRAMIENTA PRUEBA",
        description: "Prueba automática"
      });
      return tool;
    }, testToolPath);
    assert.equal(nativeResult.id, "herramienta-prueba");
    await page.waitForFunction(() => document.querySelectorAll(".tool-row").length === 5);

    await page.locator('[data-view="tools"]').click();
    await page.locator('[data-tool-id="herramienta-metas-box"]').click();
    let metasPage = null;
    for (let attempt = 0; attempt < 40 && !metasPage; attempt += 1) {
      metasPage = context.pages().find((candidate) => candidate.url().includes("/tools/herramienta-metas-box/"));
      if (!metasPage) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(metasPage, "No se abrió la herramienta de Metas.");
    await metasPage.waitForLoadState("domcontentloaded");
    await metasPage.waitForFunction(() => window.alvsolDesktop?.storage);
    const metasPermissions = await metasPage.evaluate(async () => {
      await window.alvsolDesktop.storage.setJson("prueba-escritorio", JSON.stringify({ guardado: true }));
      const stored = await window.alvsolDesktop.storage.getJson("prueba-escritorio");
      if (JSON.parse(stored.valueJson).guardado !== true) throw new Error("No se recuperó el dato local.");
      return {
        updates: typeof window.alvsolDesktop.updates,
        backups: typeof window.alvsolDesktop.backups,
        sync: typeof window.alvsolDesktop.sync
      };
    });
    assert.deepEqual(metasPermissions, { updates: "undefined", backups: "undefined", sync: "undefined" });
    await metasPage.screenshot({ path: path.join(cacheRoot, "metas.png") });
    await metasPage.close();

    for (const toolId of ["herramienta-compras", "herramienta-presupuesto", "herramienta-cuadre"]) {
      await page.locator(`[data-tool-id="${toolId}"]`).click();
      let toolPage = null;
      for (let attempt = 0; attempt < 40 && !toolPage; attempt += 1) {
        toolPage = context.pages().find((candidate) => candidate.url().includes(`/tools/${toolId}/`));
        if (!toolPage) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(toolPage, `No se abrió ${toolId}.`);
      toolPage.on("pageerror", (error) => pageErrors.push(error.message));
      await toolPage.waitForLoadState("domcontentloaded");
      assert.ok(await toolPage.locator("body").isVisible());
      if (toolId === "herramienta-cuadre") {
        const libraries = await toolPage.evaluate(() => ({
          xlsx: typeof window.XLSX,
          pdf: typeof window.pdfjsLib,
          jsPdf: typeof window.jspdf?.jsPDF,
          autoTable: typeof window.jspdf?.jsPDF?.API?.autoTable
        }));
        assert.deepEqual(libraries, { xlsx: "object", pdf: "object", jsPdf: "function", autoTable: "function" });
      }
      await toolPage.close();
    }

    const syncStatus = await page.evaluate(() => window.alvsolDesktop.sync.publish());
    assert.equal(syncStatus.status, "up-to-date");
    assert.ok(fs.readdirSync(syncRoot).some((name) => name.endsWith(".db")));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log(`Prueba de escritorio completa. Capturas: ${cacheRoot}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!child.killed) child.kill("SIGKILL");
  }

  if (stderr.trim()) console.error(stderr.trim());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
