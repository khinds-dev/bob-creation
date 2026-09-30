// ============================================================
// src/core/worker-pool.ts
// Multi-worker concurrency controller
// ============================================================

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Job, WorkerInfo, JobState, HandlerFunction, HandlerResult } from '../types';
import { getLogger } from '../config/logger';

export interface WorkerPoolOptions {
  maxWorkers: number;
}

export class WorkerPool extends EventEmitter {
  private workers: Map<string, WorkerInfo> = new Map();
  private readonly maxWorkers: number;
  private busyCount = 0;

  constructor(opts: WorkerPoolOptions) {
    super();
    this.maxWorkers = opts.maxWorkers;
    // Pre-register worker slots
    for (let i = 0; i < this.maxWorkers; i++) {
      const workerId = `worker-${uuidv4().slice(0, 8)}`;
      this.workers.set(workerId, {
        id: workerId,
        state: 'idle',
        startedAt: new Date(),
        completedJobs: 0,
        failedJobs: 0,
      });
    }
  }

  get availableCount(): number {
    return this.maxWorkers - this.busyCount;
  }

  get totalWorkers(): number {
    return this.maxWorkers;
  }

  get activeCount(): number {
    return this.busyCount;
  }

  getWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  private acquireWorker(): WorkerInfo | null {
    for (const worker of this.workers.values()) {
      if (worker.state === 'idle') return worker;
    }
    return null;
  }

  canAcceptJob(): boolean {
    return this.busyCount < this.maxWorkers;
  }

  /**
   * Execute a job on an available worker.
   * Returns a promise that resolves when the job completes.
   * The caller is responsible for scheduling and retry logic.
   */
  async executeJob(
    job: Job,
    handler: HandlerFunction,
    onStateChange: (job: Job, newState: JobState, error?: string, output?: Record<string, unknown>) => void
  ): Promise<void> {
    const worker = this.acquireWorker();
    if (!worker) {
      throw new Error(`No available workers (max: ${this.maxWorkers})`);
    }

    worker.state = 'busy';
    worker.currentJobId = job.id;
    this.busyCount++;

    const log = getLogger();
    log.info('WorkerPool: starting job', { workerId: worker.id, jobId: job.id });

    // Signal running
    onStateChange(job, JobState.RUNNING);

    const timeoutMs = job.timeoutMs;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let timedOut = false;

    try {
      const result = await Promise.race<HandlerResult>([
        handler({
          jobId: job.id,
          stepId: job.stepId,
          workflowExecutionId: job.workflowExecutionId,
          input: job.input,
          retryCount: job.retryCount,
          logger: {
            info: (msg, meta) => log.info(msg, { ...meta, jobId: job.id }),
            warn: (msg, meta) => log.warn(msg, { ...meta, jobId: job.id }),
            error: (msg, meta) => log.error(msg, { ...meta, jobId: job.id }),
          },
        }),
        new Promise<HandlerResult>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Job ${job.id} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);

      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (result.success) {
        worker.completedJobs++;
        onStateChange(job, JobState.COMPLETED, undefined, result.output);
        log.info('WorkerPool: job completed', { workerId: worker.id, jobId: job.id });
      } else {
        worker.failedJobs++;
        onStateChange(job, JobState.FAILED, result.error ?? 'Handler returned failure');
        log.warn('WorkerPool: job failed (handler)', { workerId: worker.id, jobId: job.id, error: result.error });
      }
    } catch (err: unknown) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      worker.failedJobs++;
      const message = err instanceof Error ? err.message : String(err);
      onStateChange(job, JobState.FAILED, message);
      log.error('WorkerPool: job error', { workerId: worker.id, jobId: job.id, error: message, timedOut });
    } finally {
      worker.state = 'idle';
      worker.currentJobId = undefined;
      this.busyCount--;
      this.emit('workerIdle', worker);
    }
  }
}
