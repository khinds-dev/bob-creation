// ============================================================
// src/storage/storage-interface.ts
// Abstract storage interface
// ============================================================

import { WorkflowExecution, Job, DAGDefinition, StorageSnapshot } from '../types';

export interface IStorage {
  // DAG definitions
  saveDAG(dag: DAGDefinition): Promise<void>;
  getDAG(dagId: string): Promise<DAGDefinition | null>;
  listDAGs(): Promise<DAGDefinition[]>;
  deleteDAG(dagId: string): Promise<boolean>;

  // Workflow executions
  saveWorkflow(workflow: WorkflowExecution): Promise<void>;
  getWorkflow(workflowId: string): Promise<WorkflowExecution | null>;
  listWorkflows(opts?: {
    dagId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: WorkflowExecution[]; total: number }>;
  deleteWorkflow(workflowId: string): Promise<boolean>;

  // Jobs
  saveJob(job: Job): Promise<void>;
  getJob(jobId: string): Promise<Job | null>;
  listJobs(opts?: {
    workflowExecutionId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Job[]; total: number }>;

  // Dead-letter queue
  pushToDLQ(job: Job): Promise<void>;
  getDLQJobs(limit?: number, offset?: number): Promise<{ items: Job[]; total: number }>;
  removeFromDLQ(jobId: string): Promise<boolean>;

  // Persistence
  snapshot(): Promise<StorageSnapshot>;
  restore(snapshot: StorageSnapshot): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
