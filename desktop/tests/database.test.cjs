const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const LocalDatabase = require("../src/local-database.cjs");

test("LocalDatabase guarda y recupera el estado de una herramienta", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alvsol-db-"));
  const filePath = path.join(root, "data", "alvsol.db");
  const database = await LocalDatabase.create(filePath);
  try {
    database.setToolState("herramienta-prueba", "estado", JSON.stringify({ value: 42 }));
    const stored = database.getToolState("herramienta-prueba", "estado");
    assert.deepEqual(JSON.parse(stored.valueJson), { value: 42 });
    assert.equal(database.integrityCheck(), true);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
