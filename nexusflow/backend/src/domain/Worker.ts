/**
 * Worker — represents a logical execution unit within the worker pool.
 * Workers are managed by the WorkerPool and execute queued tasks.
 */

export enum WorkerStatus {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  STOPPED = 'STOPPED',
}

export interface Worker {
  readonly id: string;
  status: WorkerStatus;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  /** Cumulative execution time across all tasks handled by this worker (ms) */
  totalDurationMs: number;
  readonly startedAt: Date;
  lastActiveAt: Date;
}

/** Snapshot of worker pool aggregate metrics */
export interface WorkerPoolStats {
  readonly totalWorkers: number;
  readonly activeWorkers: number;
  readonly idleWorkers: number;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly avgDurationMs: number;
  readonly throughputPerMinute: number;
}
