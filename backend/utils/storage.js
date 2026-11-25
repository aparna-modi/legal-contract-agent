const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LOCAL_UPLOAD_DIR = path.join(__dirname, "../uploads");
fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const encodeKey = (key) => String(key).split("/").map(encodeURIComponent).join("/");

class LocalStorageAdapter {
  constructor() { this.provider = "local"; }

  async putObject({ key, buffer, localPath }) {
    const safeName = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    const target = path.join(LOCAL_UPLOAD_DIR, path.basename(safeName));
    if (localPath && path.resolve(localPath) === path.resolve(target)) {
      return { provider: "local", storageKey: path.basename(target), filePath: target };
    }
    const data = buffer || (localPath ? await fs.promises.readFile(localPath) : Buffer.alloc(0));
    await fs.promises.writeFile(target, data);
    if (localPath && path.resolve(localPath) !== path.resolve(target)) {
      await fs.promises.unlink(localPath).catch(() => {});
    }
    return { provider: "local", storageKey: path.basename(target), filePath: target };
  }

  async getBuffer({ storageKey, filePath }) {
    const resolved = (filePath && fs.existsSync(filePath))
      ? filePath
      : storageKey ? path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey)) : null;
    if (!resolved || !fs.existsSync(resolved)) {
      const err = new Error("Contract file not found in local storage.");
      err.status = 404;
      throw err;
    }
    return fs.promises.readFile(resolved);
  }

  async deleteObject({ storageKey, filePath }) {
    const targets = new Set([filePath, storageKey ? path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey)) : null].filter(Boolean));
    for (const p of targets) {
      if (fs.existsSync(p)) await fs.promises.unlink(p).catch(() => {});
    }
  }
}

class S3StorageAdapter {
  constructor() {
    this.provider = "s3";
    this.bucket = process.env.S3_BUCKET || "";
    this.region = process.env.S3_REGION || "us-east-1";
    this.endpoint = (process.env.S3_ENDPOINT || "").replace(/\/+$/, "");
    this.accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
    this.secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";
    this.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(this.endpoint);
    this.sseMode = process.env.S3_SSE || "AES256";
  }

  _buildUrl(key) {
    const enc = encodeKey(key);
    if (this.endpoint) return `${this.endpoint}/${this.bucket}/${enc}`;
    if (this.forcePathStyle) return `https://s3.${this.region}.amazonaws.com/${this.bucket}/${enc}`;
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${enc}`;
  }

  _signRequest(method, urlObj, payload, extra = {}) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(payload || Buffer.alloc(0));

    const lower = {};
    for (const [k, v] of Object.entries({ host: urlObj.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra })) {
      lower[k.toLowerCase()] = String(v).trim();
    }
    const keys = Object.keys(lower).sort();
    const canonical = [
      method, urlObj.pathname, urlObj.search ? urlObj.search.slice(1) : "",
      keys.map((k) => `${k}:${lower[k]}\n`).join(""),
      keys.join(";"), payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, dateStamp), this.region), "s3"), "aws4_request");
    const sig = crypto.createHmac("sha256", signingKey).update(toSign).digest("hex");

    return { ...lower, authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${keys.join(";")}, Signature=${sig}` };
  }

  async putObject({ key, buffer, localPath, contentType = "application/octet-stream" }) {
    const body = buffer || (await fs.promises.readFile(localPath));
    const urlStr = this._buildUrl(key);
    const extra = { "content-type": contentType };
    if (this.sseMode && !this.endpoint) extra["x-amz-server-side-encryption"] = this.sseMode;

    const res = await fetch(urlStr, { method: "PUT", headers: this._signRequest("PUT", new URL(urlStr), body, extra), body, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`S3 PUT failed with HTTP ${res.status}`);
    if (localPath && fs.existsSync(localPath)) await fs.promises.unlink(localPath).catch(() => {});
    return { provider: "s3", storageKey: key, filePath: "" };
  }

  async getBuffer({ storageKey }) {
    const urlStr = this._buildUrl(storageKey);
    const res = await fetch(urlStr, { method: "GET", headers: this._signRequest("GET", new URL(urlStr), Buffer.alloc(0)), signal: AbortSignal.timeout(30000) });
    if (res.status === 404) { const e = new Error("Contract object not found in cloud storage."); e.status = 404; throw e; }
    if (!res.ok) throw new Error(`S3 GET failed with HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject({ storageKey }) {
    if (!storageKey) return;
    const urlStr = this._buildUrl(storageKey);
    await fetch(urlStr, { method: "DELETE", headers: this._signRequest("DELETE", new URL(urlStr), Buffer.alloc(0)), signal: AbortSignal.timeout(15000) }).catch(() => {});
  }
}

function getAdapter(explicit) {
  const mode = (explicit || process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (mode === "s3" && (explicit === "s3" || (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY))) {
    return new S3StorageAdapter();
  }
  return new LocalStorageAdapter();
}

const storageService = {
  getProviderName: () => getAdapter().provider,
  putObject: (opts) => getAdapter().putObject(opts),
  getBuffer: (opts) => getAdapter(opts.storageProvider).getBuffer(opts),
  deleteObject: (opts) => getAdapter(opts.storageProvider).deleteObject(opts),
  LocalStorageAdapter,
  S3StorageAdapter,
  LOCAL_UPLOAD_DIR,
};

module.exports = { storageService };
