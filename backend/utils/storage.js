const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const LOCAL_UPLOAD_DIR = path.join(__dirname, "../uploads");
fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const encodeKey = (key) => String(key).split("/").map(encodeURIComponent).join("/");

function isMongoReady() {
  return mongoose.connection?.readyState === 1 && Boolean(mongoose.connection.db);
}

class LocalStorageAdapter {
  constructor() {
    this.provider = "local";
  }

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
    const resolved =
      filePath && fs.existsSync(filePath)
        ? filePath
        : storageKey
          ? path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey))
          : null;
    if (!resolved || !fs.existsSync(resolved)) {
      const err = new Error("Contract file not found in local storage.");
      err.status = 404;
      throw err;
    }
    return fs.promises.readFile(resolved);
  }

  async deleteObject({ storageKey, filePath }) {
    const targets = new Set(
      [filePath, storageKey ? path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey)) : null].filter(Boolean)
    );
    for (const fileTarget of targets) {
      if (fs.existsSync(fileTarget)) {
        await fs.promises.unlink(fileTarget).catch(() => {});
      }
    }
  }
}

class GridFSStorageAdapter {
  constructor() {
    this.provider = "gridfs";
  }

  _bucket() {
    if (!isMongoReady()) {
      const err = new Error("MongoDB GridFS storage is unavailable because the database is disconnected.");
      err.status = 503;
      throw err;
    }
    return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "contractFiles",
    });
  }

  async putObject({ key, buffer, localPath, contentType = "application/octet-stream" }) {
    const data = buffer || (localPath ? await fs.promises.readFile(localPath) : Buffer.alloc(0));
    const bucket = this._bucket();
    const fileId = await new Promise((resolve, reject) => {
      const stream = bucket.openUploadStream(String(key), {
        metadata: { key: String(key), contentType },
      });
      stream.on("error", reject);
      stream.on("finish", () => resolve(stream.id));
      stream.end(data);
    });
    if (localPath && fs.existsSync(localPath)) {
      await fs.promises.unlink(localPath).catch(() => {});
    }
    return { provider: "gridfs", storageKey: String(fileId), filePath: "" };
  }

  async getBuffer({ storageKey }) {
    if (!storageKey) {
      const err = new Error("Missing GridFS file reference.");
      err.status = 404;
      throw err;
    }
    const bucket = this._bucket();
    const isObjectId = mongoose.Types.ObjectId.isValid(storageKey);

    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = isObjectId
        ? bucket.openDownloadStream(new mongoose.Types.ObjectId(storageKey))
        : bucket.openDownloadStreamByName(String(storageKey));

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", () => {
        const err = new Error("Contract file not found in database storage.");
        err.status = 404;
        reject(err);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  async deleteObject({ storageKey }) {
    if (!storageKey || !isMongoReady()) return;
    if (!mongoose.Types.ObjectId.isValid(storageKey)) return;
    try {
      await this._bucket().delete(new mongoose.Types.ObjectId(storageKey));
    } catch {
      // Ignore already-deleted or missing GridFS file.
    }
  }
}

class S3StorageAdapter {
  constructor() {
    this.provider = "s3";
    this.bucket = (process.env.S3_BUCKET || "").trim();
    this.region = (process.env.S3_REGION || "us-east-1").trim();
    this.endpoint = (process.env.S3_ENDPOINT || "").trim().replace(/\/+$/, "");
    this.accessKeyId = (process.env.S3_ACCESS_KEY_ID || "").trim();
    this.secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || "").trim();
    this.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(this.endpoint);
    this.sseMode = process.env.S3_SSE || "AES256";
  }

  _buildUrl(key) {
    const enc = encodeKey(key);
    if (this.endpoint) {
      // Avoid duplicating bucket segment when user already included /<bucket> in S3_ENDPOINT.
      if (this.bucket && this.endpoint.endsWith(`/${this.bucket}`)) {
        return `${this.endpoint}/${enc}`;
      }
      return `${this.endpoint}/${this.bucket}/${enc}`;
    }
    if (this.forcePathStyle) return `https://s3.${this.region}.amazonaws.com/${this.bucket}/${enc}`;
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${enc}`;
  }

  _signRequest(method, urlObj, payload, extra = {}) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(payload || Buffer.alloc(0));

    const lower = {};
    for (const [k, v] of Object.entries({
      host: urlObj.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extra,
    })) {
      lower[k.toLowerCase()] = String(v).trim();
    }
    const keys = Object.keys(lower).sort();
    const canonical = [
      method,
      urlObj.pathname,
      urlObj.search ? urlObj.search.slice(1) : "",
      keys.map((k) => `${k}:${lower[k]}\n`).join(""),
      keys.join(";"),
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, dateStamp), this.region), "s3"),
      "aws4_request"
    );
    const sig = crypto.createHmac("sha256", signingKey).update(toSign).digest("hex");

    const signedHeaders = { ...lower };
    delete signedHeaders.host;
    signedHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${keys.join(";")}, Signature=${sig}`;
    return signedHeaders;
  }

  async putObject({ key, buffer, localPath, contentType = "application/octet-stream" }) {
    const body = buffer || (await fs.promises.readFile(localPath));
    const urlStr = this._buildUrl(key);
    const extra = { "content-type": contentType };
    if (this.sseMode && !this.endpoint) extra["x-amz-server-side-encryption"] = this.sseMode;

    const res = await fetch(urlStr, {
      method: "PUT",
      headers: this._signRequest("PUT", new URL(urlStr), body, extra),
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`S3 PUT failed with HTTP ${res.status}`);
    if (localPath && fs.existsSync(localPath)) await fs.promises.unlink(localPath).catch(() => {});
    return { provider: "s3", storageKey: key, filePath: "" };
  }

  async getBuffer({ storageKey }) {
    const urlStr = this._buildUrl(storageKey);
    const res = await fetch(urlStr, {
      method: "GET",
      headers: this._signRequest("GET", new URL(urlStr), Buffer.alloc(0)),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) {
      const err = new Error("Contract object not found in cloud storage.");
      err.status = 404;
      throw err;
    }
    if (!res.ok) throw new Error(`S3 GET failed with HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject({ storageKey }) {
    if (!storageKey) return;
    const urlStr = this._buildUrl(storageKey);
    await fetch(urlStr, {
      method: "DELETE",
      headers: this._signRequest("DELETE", new URL(urlStr), Buffer.alloc(0)),
      signal: AbortSignal.timeout(15000),
    }).catch(() => {});
  }
}

function hasS3Config() {
  return Boolean(
    (process.env.S3_BUCKET || "").trim() &&
      (process.env.S3_ACCESS_KEY_ID || "").trim() &&
      (process.env.S3_SECRET_ACCESS_KEY || "").trim()
  );
}

function getAdapter(explicit) {
  const configured = (explicit || process.env.STORAGE_PROVIDER || "").trim().toLowerCase();

  if (configured === "s3" && (explicit === "s3" || hasS3Config())) {
    return new S3StorageAdapter();
  }
  if (configured === "gridfs") {
    return isMongoReady() ? new GridFSStorageAdapter() : new LocalStorageAdapter();
  }
  if (configured === "local") {
    return new LocalStorageAdapter();
  }

  // In production without S3 credentials, persist files in MongoDB GridFS so
  // ephemeral hosts (such as Render free tier) never lose PDFs across restarts.
  if (process.env.NODE_ENV === "production" && isMongoReady()) {
    return new GridFSStorageAdapter();
  }
  return new LocalStorageAdapter();
}

const storageService = {
  getProviderName: () => getAdapter().provider,
  async putObject(opts) {
    const primary = getAdapter();
    try {
      return await primary.putObject(opts);
    } catch (primaryErr) {
      if (primary.provider === "s3") {
        console.warn(
          `S3 upload failed (${primaryErr.message}); falling back to ${isMongoReady() ? "GridFS" : "local"} storage.`
        );
        const fallback = isMongoReady() ? new GridFSStorageAdapter() : new LocalStorageAdapter();
        return fallback.putObject(opts);
      }
      throw primaryErr;
    }
  },
  getBuffer: (opts) => getAdapter(opts.storageProvider).getBuffer(opts),
  deleteObject: (opts) => getAdapter(opts.storageProvider).deleteObject(opts),
  LocalStorageAdapter,
  GridFSStorageAdapter,
  S3StorageAdapter,
  LOCAL_UPLOAD_DIR,
};

module.exports = { storageService };
