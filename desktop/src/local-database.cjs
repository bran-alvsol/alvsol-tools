const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

class LocalDatabase {
  static async create(filePath) {
    const wasmBinary = fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"));
    const SQL = await initSqlJs({ wasmBinary });
    return new LocalDatabase(filePath, SQL);
  }

  constructor(filePath, SQL) {
    this.filePath = filePath;
    this.SQL = SQL;
    this.db = null;
    this.open();
  }

  open() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const bytes = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath) : null;
    this.db = bytes?.length ? new this.SQL.Database(bytes) : new this.SQL.Database();
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_state (
        tool_id TEXT NOT NULL,
        state_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tool_id, state_key)
      );

      CREATE TABLE IF NOT EXISTS installed_tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL,
        entry_file TEXT NOT NULL DEFAULT 'index.html',
        installed_at TEXT NOT NULL,
        package_name TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    this.flush();
  }

  flush() {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()));
    fs.copyFileSync(temporaryPath, this.filePath);
    fs.unlinkSync(temporaryPath);
  }

  close() {
    if (!this.db) return;
    this.flush();
    this.db.close();
    this.db = null;
  }

  queryOne(sql, parameters = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(parameters);
      return statement.step() ? statement.getAsObject() : null;
    } finally {
      statement.free();
    }
  }

  queryAll(sql, parameters = []) {
    const statement = this.db.prepare(sql);
    const rows = [];
    try {
      statement.bind(parameters);
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  getToolState(toolId, key) {
    return this.queryOne(
      "SELECT value_json AS valueJson, updated_at AS updatedAt FROM tool_state WHERE tool_id = ? AND state_key = ?",
      [toolId, key]
    );
  }

  setToolState(toolId, key, valueJson) {
    JSON.parse(valueJson);
    const updatedAt = new Date().toISOString();
    this.db.run(`
      INSERT INTO tool_state (tool_id, state_key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tool_id, state_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `, [toolId, key, valueJson, updatedAt]);
    this.flush();
    return { updatedAt };
  }

  removeToolState(toolId, key) {
    this.db.run("DELETE FROM tool_state WHERE tool_id = ? AND state_key = ?", [toolId, key]);
    const changed = this.db.getRowsModified() > 0;
    this.flush();
    return changed;
  }

  listInstalledTools() {
    return this.queryAll(`
      SELECT id, name, description, version, entry_file AS entry,
             installed_at AS installedAt, package_name AS packageName
      FROM installed_tools
      ORDER BY name COLLATE NOCASE
    `);
  }

  upsertInstalledTool(tool) {
    const installedAt = new Date().toISOString();
    this.db.run(`
      INSERT INTO installed_tools (id, name, description, version, entry_file, installed_at, package_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        entry_file = excluded.entry_file,
        installed_at = excluded.installed_at,
        package_name = excluded.package_name
    `, [tool.id, tool.name, tool.description, tool.version, tool.entry, installedAt, tool.packageName]);
    this.log("tool-installed", `${tool.id} v${tool.version}`);
  }

  log(eventType, detail = "") {
    this.db.run(
      "INSERT INTO activity_log (event_type, detail, created_at) VALUES (?, ?, ?)",
      [eventType, detail, new Date().toISOString()]
    );
    this.flush();
  }

  recentActivity(limit = 20) {
    return this.queryAll(`
      SELECT event_type AS eventType, detail, created_at AS createdAt
      FROM activity_log ORDER BY id DESC LIMIT ?
    `, [Math.max(1, Math.min(100, Number(limit) || 20))]);
  }

  async backup(destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    this.flush();
    fs.copyFileSync(this.filePath, destination);
    return destination;
  }

  integrityCheck(filePath = this.filePath) {
    const candidate = new this.SQL.Database(fs.readFileSync(filePath));
    try {
      const result = candidate.exec("PRAGMA integrity_check;");
      return result?.[0]?.values?.[0]?.[0] === "ok";
    } finally {
      candidate.close();
    }
  }

  replaceWith(sourcePath) {
    if (!this.integrityCheck(sourcePath)) {
      throw new Error("El respaldo no superó la revisión de integridad.");
    }
    const bytes = fs.readFileSync(sourcePath);
    if (this.db) this.db.close();
    this.db = new this.SQL.Database(bytes);
    this.flush();
  }
}

module.exports = LocalDatabase;
