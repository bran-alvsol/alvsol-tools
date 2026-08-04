const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/local-database.cjs",
  "src/config-store.cjs",
  "src/renderer/index.html",
  "src/renderer/styles.css",
  "src/renderer/app.js",
  "resources/bundled-tools.json",
  "ESPECIFICACION-HERRAMIENTAS-ALVSOL.md",
  "PROMPT-PARA-ACTUALIZAR-HERRAMIENTAS.txt"
];

for (const relativePath of required) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Falta ${relativePath}`);
  }
}

const tools = JSON.parse(fs.readFileSync(path.join(root, "resources/bundled-tools.json"), "utf8"));
if (!Array.isArray(tools) || tools.length < 4) throw new Error("La lista de herramientas está incompleta.");
for (const tool of tools) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.id)) throw new Error(`Identificador inválido: ${tool.id}`);
  const entry = path.resolve(root, "..", "tools", tool.id, tool.entry);
  if (!fs.existsSync(entry)) throw new Error(`No existe la entrada de ${tool.id}`);
}

console.log(`Verificación completa: ${tools.length} herramientas registradas.`);
