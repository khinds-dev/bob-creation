// ============================================================
// src/types/index.ts
// All domain interfaces, schema types, and enum definitions
// ============================================================

export enum JobState {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  RETRYING = 'RETRYING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
  CRITICAL = 20,
}

export enum EventType {
  JOB_SUBMITTED = 'JOB_SUBMITTED',
  JOB_STARTED = 'JOB_STARTED',
  JOB_COMPLETED = 'JOB_COMPLETED',
  JOB_FAILED = 'JOB_FAILED',
  JOB_RETRYING = 'JOB_RETRYING',
  JOB_CANCELLED = 'JOB_CANCELLED',
  JOB_DLQ = 'JOB_DLQ',
  WORKFLOW_SUBMITTED = 'WORKFLOW_SUBMITTED',
  WORKFLOW_STARTED = 'WORKFLOW_STARTED',
  WORKFLOW_COMPLETED = 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED = 'WORKFLOW_FAILED',
  WORKFLOW_CANCELLED = 'WORKFLOW_CANCELLED',
  STEP_STARTED = 'STEP_STARTED',
  STEP_COMPLETED = 'STEP_COMPLETED',
  STEP_FAILED = 'STEP_FAILED',
  METRIC = 'METRIC',
  LOG = 'LOG',
}

export interface RetryPolicy {
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffMultiplier: number;
}

export interface StepDefinition {
  id: string;
  name: string;
  handler: string;
  input?: Record<string, unknown>;
  dependsOn?: string[];
  retryPolicy?: Partial<RetryPolicy>;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface DAGDefinition {
  id: string;
  name: string;
  description?: string;
  steps: StepDefinition[];
  defaultRetryPolicy?: Partial<RetryPolicy>;
  defaultTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface StepExecution {
  stepId: string;
  workflowExecutionId: string;
  state: JobState;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
}

export interface WorkflowExecution {
  id: string;
  dagId: string;
  dagName: string;
  state: JobState;
  steps: Record<string, StepExecution>;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface Job {
  id: string;
  workflowExecutionId: string;
  stepId: string;
  handler: string;
  input: Record<string, unknown>;
  state: JobState;
  priority: number;
  retryCount: number;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  createdAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  workerId?: string;
  dlq: boolean;
}

export interface QueuedJob {
  job: Job;
  priority: number;
  enqueuedAt: Date;
}

export interface WorkerInfo {
  id: string;
  state: 'idle' | 'busy';
  currentJobId?: string;
  startedAt: Date;
  completedJobs: number;
  failedJobs: number;
}

export interface EngineMetrics {
  totalJobsSubmitted: number;
  totalJobsCompleted: number;
  totalJobsFailed: number;
  totalJobsCancelled: number;
  totalJobsDLQ: number;
  totalWorkflowsSubmitted: number;
  totalWorkflowsCompleted: number;
  totalWorkflowsFailed: number;
  activeWorkers: number;
  idleWorkers: number;
  queueDepth: number;
  dlqDepth: number;
  averageJobDurationMs: number;
  uptimeMs: number;
}

export interface EngineEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  payload: Record<string, unknown>;
  workflowExecutionId?: string;
  jobId?: string;
  stepId?: string;
}

export interface HandlerResult {
  output?: Record<string, unknown>;
  error?: string;
  success: boolean;
}

export interface HandlerContext {
  jobId: string;
  stepId: string;
  workflowExecutionId: string;
  input: Record<string, unknown>;
  retryCount: number;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export type HandlerFunction = (ctx: HandlerContext) => Promise<HandlerResult>;

export interface StorageSnapshot {
  workflows: Record<string, WorkflowExecution>;
  jobs: Record<string, Job>;
  dlq: Job[];
  timestamp: Date;
  version: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SubmitWorkflowRequest {
  dagId: string;
  input?: Record<string, unknown>;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface SubmitDAGRequest {
  dag: DAGDefinition;
}

export interface QueryParams {
  page?: number;
  pageSize?: number;
  state?: JobState;
  dagId?: string;
  from?: string;
  to?: string;
}
