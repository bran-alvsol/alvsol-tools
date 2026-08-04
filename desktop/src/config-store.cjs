const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.read();
    if (!this.data.deviceId) {
      this.data.deviceId = crypto.randomUUID();
      this.write();
    }
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  get(key, fallback = null) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.write();
    return value;
  }

  merge(values) {
    Object.assign(this.data, values);
    this.write();
  }

  write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), "utf8");
    fs.copyFileSync(temporaryPath, this.filePath);
    fs.unlinkSync(temporaryPath);
  }
}

module.exports = ConfigStore;
