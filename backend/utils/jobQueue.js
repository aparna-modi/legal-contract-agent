const crypto = require("crypto");
const { EventEmitter } = require("events");

const MAX_CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 3);
const JOB_RETENTION_MS = 30 * 60 * 1000;

class ExtractionJobQueue {
  constructor() {
    this.jobs = new Map();
    this.pending = [];
    this.activeCount = 0;
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  enqueue({ contractId, userId, taskFn }) {
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      contractId: String(contractId),
      userId: String(userId),
      status: "queued",
      stage: "queued",
      percent: 5,
      message: "Queued for background analysis...",
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this._emit(job);
    this.pending.push({ job, taskFn });
    this._drain();
    this._prune();
    return job;
  }

  getJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    return job && (!userId || job.userId === String(userId)) ? job : null;
  }

  subscribe(contractId, listener) {
    const ch = `contract:${contractId}`;
    this.emitter.on(ch, listener);
    return () => this.emitter.off(ch, listener);
  }

  getQueueStats() {
    let completed = 0;
    let failed = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "completed") completed += 1;
      if (j.status === "failed") failed += 1;
    }
    return { active: this.activeCount, queued: this.pending.length, completed, failed, maxConcurrency: MAX_CONCURRENCY };
  }

  _emit(j) {
    this.emitter.emit(`contract:${j.contractId}`, {
      jobId: j.id, contractId: j.contractId, status: j.status, stage: j.stage,
      percent: j.percent, message: j.message, error: j.error, updatedAt: j.updatedAt,
    });
  }

  _drain() {
    while (this.activeCount < MAX_CONCURRENCY && this.pending.length) {
      const next = this.pending.shift();
      this.activeCount += 1;
      this._run(next.job, next.taskFn);
    }
  }

  async _run(job, taskFn) {
    const update = (stage, percent, message) => {
      Object.assign(job, { status: "processing", stage, percent, message, updatedAt: new Date().toISOString() });
      this._emit(job);
    };
    try {
      update("extracting", 20, "Streaming contract to AI worker pool...");
      const res = await taskFn(update);
      Object.assign(job, {
        status: "completed", stage: "completed", percent: 100,
        message: "Contract analysis and vector indexing complete.",
        result: { savedClausesCount: res.savedClausesCount, vectorsIndexedCount: res.vectorsIndexedCount },
        updatedAt: new Date().toISOString(),
      });
      this._emit(job);
    } catch (err) {
      Object.assign(job, {
        status: "failed", stage: "failed", percent: 100,
        error: err?.message || "Background extraction failed.",
        message: err?.message || "Background extraction failed.",
        updatedAt: new Date().toISOString(),
      });
      this._emit(job);
    } finally {
      this.activeCount -= 1;
      this._drain();
    }
  }

  _prune() {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, j] of this.jobs) {
      if (["completed", "failed"].includes(j.status) && Date.parse(j.updatedAt) < cutoff) this.jobs.delete(id);
    }
  }
}

module.exports = { extractionQueue: new ExtractionJobQueue() };
