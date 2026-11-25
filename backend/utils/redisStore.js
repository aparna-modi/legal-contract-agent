let redisClient = null;
let redisReady = false;
let initialized = false;
const memoryCache = new Map();

function initRedis() {
  if (initialized) return redisClient;
  initialized = true;
  const url = (process.env.REDIS_URL || "").trim();
  if (!url) return null;

  try {
    const Redis = require("ioredis");
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 4000,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
    });
    redisClient.on("ready", () => { redisReady = true; console.log("Redis connected"); });
    redisClient.on("error", () => { redisReady = false; });
    redisClient.on("close", () => { redisReady = false; });
  } catch {
    redisClient = null;
    redisReady = false;
  }
  return redisClient;
}

const getRedisStatus = () =>
  (process.env.REDIS_URL || "").trim() ? { mode: "redis", connected: redisReady } : { mode: "memory-fallback", connected: false };

async function cacheGetJson(key) {
  initRedis();
  if (redisClient && redisReady) {
    try {
      const raw = await redisClient.get(`lca:cache:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {}
  }
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { memoryCache.delete(key); return null; }
  return hit.value;
}

async function cacheSetJson(key, value, ttlSeconds = 30) {
  initRedis();
  if (redisClient && redisReady) {
    try { await redisClient.set(`lca:cache:${key}`, JSON.stringify(value), "EX", ttlSeconds); return; } catch {}
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (memoryCache.size > 500) memoryCache.delete(memoryCache.keys().next().value);
}

async function cacheDelete(key) {
  memoryCache.delete(key);
  if (redisClient && redisReady) await redisClient.del(`lca:cache:${key}`).catch(() => {});
}

class HybridRateLimitStore {
  constructor(prefix = "rl") {
    this.prefix = prefix;
    this.windowMs = 15 * 60 * 1000;
    this.localHits = new Map();
  }

  init(options) {
    this.windowMs = options.windowMs || this.windowMs;
    initRedis();
  }

  async increment(key) {
    const fullKey = `lca:${this.prefix}:${key}`;
    if (redisClient && redisReady) {
      try {
        const count = await redisClient.incr(fullKey);
        if (count === 1) await redisClient.pexpire(fullKey, this.windowMs);
        const pttl = await redisClient.pttl(fullKey);
        return { totalHits: count, resetTime: new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs)) };
      } catch {}
    }
    const now = Date.now();
    const cur = this.localHits.get(fullKey);
    if (!cur || cur.resetMs <= now) {
      const resetMs = now + this.windowMs;
      this.localHits.set(fullKey, { count: 1, resetMs });
      return { totalHits: 1, resetTime: new Date(resetMs) };
    }
    cur.count += 1;
    return { totalHits: cur.count, resetTime: new Date(cur.resetMs) };
  }

  async decrement(key) {
    const fullKey = `lca:${this.prefix}:${key}`;
    if (redisClient && redisReady) return redisClient.decr(fullKey).catch(() => {});
    const cur = this.localHits.get(fullKey);
    if (cur && cur.count > 0) cur.count -= 1;
  }

  async resetKey(key) {
    const fullKey = `lca:${this.prefix}:${key}`;
    this.localHits.delete(fullKey);
    if (redisClient && redisReady) await redisClient.del(fullKey).catch(() => {});
  }
}

async function closeRedis() {
  if (!redisClient) return;
  try { await redisClient.quit(); } catch { redisClient.disconnect(); }
  redisReady = false;
}

module.exports = { initRedis, getRedisStatus, cacheGetJson, cacheSetJson, cacheDelete, HybridRateLimitStore, closeRedis };
