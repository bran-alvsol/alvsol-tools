const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ConfigStore = require("../src/config-store.cjs");

test("ConfigStore conserva la configuración y crea un dispositivo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alvsol-config-"));
  try {
    const filePath = path.join(root, "config.json");
    const first = new ConfigStore(filePath);
    assert.match(first.get("deviceId"), /^[0-9a-f-]{36}$/i);
    first.set("syncFolder", "C:\\OneDrive\\ALVSOL");
    const second = new ConfigStore(filePath);
    assert.equal(second.get("syncFolder"), "C:\\OneDrive\\ALVSOL");
    assert.equal(second.get("deviceId"), first.get("deviceId"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
