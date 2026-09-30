/**
 * Pipeline — a named collection of tasks forming a Directed Acyclic Graph (DAG).
 * Each pipeline has an independent execution context and lifecycle.
 */

export enum PipelineStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Aggregate root for a task pipeline */
export interface Pipeline {
  readonly id: string;
  name: string;
  description?: string;
  status: PipelineStatus;
  /** Ordered list of task IDs that belong to this pipeline */
  readonly taskIds: string[];
  readonly createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  /** Arbitrary metadata tags */
  readonly tags: string[];
}
