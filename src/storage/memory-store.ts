// ============================================================
// src/storage/memory-store.ts
// In-memory storage implementation with optional persistence
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { WorkflowExecution, Job, DAGDefinition, StorageSnapshot } from '../types';
import { IStorage } from './storage-interface';
import { getLogger } from '../config/logger';

export class MemoryStore implements IStorage {
  private dags: Map<string, DAGDefinition> = new Map();
  private workflows: Map<string, WorkflowExecution> = new Map();
  private jobs: Map<string, Job> = new Map();
  private dlq: Job[] = [];
  private readonly dataDir: string | null;
  private readonly dlqMaxSize: number;

  constructor(dataDir: string | null = null, dlqMaxSize: number = 1000) {
    this.dataDir = dataDir;
    this.dlqMaxSize = dlqMaxSize;
  }

  // ── DAG Definitions ────────────────────────────────────────

  async saveDAG(dag: DAGDefinition): Promise<void> {
    this.dags.set(dag.id, dag);
  }

  async getDAG(dagId: string): Promise<DAGDefinition | null> {
    return this.dags.get(dagId) ?? null;
  }

  async listDAGs(): Promise<DAGDefinition[]> {
    return Array.from(this.dags.values());
  }

  async deleteDAG(dagId: string): Promise<boolean> {
    return this.dags.delete(dagId);
  }

  // ── Workflow Executions ─────────────────────────────────────

  async saveWorkflow(workflow: WorkflowExecution): Promise<void> {
    this.workflows.set(workflow.id, workflow);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowExecution | null> {
    return this.workflows.get(workflowId) ?? null;
  }

  async listWorkflows(opts: {
    dagId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: WorkflowExecution[]; total: number }> {
    let items = Array.from(this.workflows.values());

    if (opts.dagId) {
      items = items.filter((w) => w.dagId === opts.dagId);
    }
    if (opts.state) {
      items = items.filter((w) => w.state === opts.state);
    }

    // Sort newest first
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = items.length;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), total };
  }

  async deleteWorkflow(workflowId: string): Promise<boolean> {
    return this.workflows.delete(workflowId);
  }

  // ── Jobs ────────────────────────────────────────────────────

  async saveJob(job: Job): Promise<void> {
    this.jobs.set(job.id, job);
  }

  async getJob(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listJobs(opts: {
    workflowExecutionId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Job[]; total: number }> {
    let items = Array.from(this.jobs.values());

    if (opts.workflowExecutionId) {
      items = items.filter((j) => j.workflowExecutionId === opts.workflowExecutionId);
    }
    if (opts.state) {
      items = items.filter((j) => j.state === opts.state);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = items.length;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), total };
  }

  // ── Dead-Letter Queue ───────────────────────────────────────

  async pushToDLQ(job: Job): Promise<void> {
    if (this.dlq.length >= this.dlqMaxSize) {
      this.dlq.shift(); // drop oldest
    }
    this.dlq.push(job);
  }

  async getDLQJobs(limit?: number, offset?: number): Promise<{ items: Job[]; total: number }> {
    const total = this.dlq.length;
    const off = offset ?? 0;
    const lim = limit ?? this.dlq.length;
    return { items: this.dlq.slice(off, off + lim), total };
  }

  async removeFromDLQ(jobId: string): Promise<boolean> {
    const idx = this.dlq.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    this.dlq.splice(idx, 1);
    return true;
  }

  // ── Persistence ─────────────────────────────────────────────

  async snapshot(): Promise<StorageSnapshot> {
    const workflows: Record<string, WorkflowExecution> = {};
    for (const [k, v] of this.workflows) workflows[k] = v;

    const jobs: Record<string, Job> = {};
    for (const [k, v] of this.jobs) jobs[k] = v;

    return {
      workflows,
      jobs,
      dlq: [...this.dlq],
      timestamp: new Date(),
      version: 1,
    };
  }

  async restore(snapshot: StorageSnapshot): Promise<void> {
    this.workflows.clear();
    this.jobs.clear();
    this.dlq.length = 0;

    for (const [k, v] of Object.entries(snapshot.workflows)) {
      // Clone to avoid mutating the snapshot object's date fields
      const wf: WorkflowExecution = { ...v };
      wf.createdAt = new Date(v.createdAt);
      if (v.startedAt) wf.startedAt = new Date(v.startedAt);
      if (v.completedAt) wf.completedAt = new Date(v.completedAt);
      this.workflows.set(k, wf);
    }

    for (const [k, v] of Object.entries(snapshot.jobs)) {
      // Clone to avoid mutating the snapshot object's date fields
      const job: Job = { ...v };
      job.createdAt = new Date(v.createdAt);
      if (v.scheduledAt) job.scheduledAt = new Date(v.scheduledAt);
      if (v.startedAt) job.startedAt = new Date(v.startedAt);
      if (v.completedAt) job.completedAt = new Date(v.completedAt);
      this.jobs.set(k, job);
    }

    for (const srcJob of snapshot.dlq) {
      // Clone DLQ jobs as well
      const job: Job = { ...srcJob, createdAt: new Date(srcJob.createdAt) };
      this.dlq.push(job);
    }

    getLogger().info('MemoryStore.restore', {
      workflows: this.workflows.size,
      jobs: this.jobs.size,
      dlq: this.dlq.length,
    });
  }

  async flush(): Promise<void> {
    if (!this.dataDir) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const snap = await this.snapshot();
      const filePath = path.join(this.dataDir, 'snapshot.json');
      const tmpPath = filePath + '.tmp';

      fs.writeFileSync(tmpPath, JSON.stringify(snap, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);

      getLogger().debug('MemoryStore.flush', { path: filePath });
    } catch (err) {
      getLogger().error('MemoryStore.flush failed', { error: String(err) });
    }
  }

  async loadFromDisk(): Promise<boolean> {
    if (!this.dataDir) return false;

    const filePath = path.join(this.dataDir, 'snapshot.json');
    if (!fs.existsSync(filePath)) return false;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const snap: StorageSnapshot = JSON.parse(raw);
      await this.restore(snap);
      return true;
    } catch (err) {
      getLogger().error('MemoryStore.loadFromDisk failed', { error: String(err) });
      return false;
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }

  // Introspection helpers (for testing)
  getDagCount(): number { return this.dags.size; }
  getWorkflowCount(): number { return this.workflows.size; }
  getJobCount(): number { return this.jobs.size; }
  getDLQCount(): number { return this.dlq.length; }
}
