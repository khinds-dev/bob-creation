// ─── Shared types mirroring backend domain types ────────────────────────────

export enum TaskPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.CRITICAL]: 'CRITICAL',
  [TaskPriority.HIGH]: 'HIGH',
  [TaskPriority.NORMAL]: 'NORMAL',
  [TaskPriority.LOW]: 'LOW',
};

export enum TaskStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum PipelineStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface TaskPayload {
  handler: string;
  args: Record<string, unknown>;
}

export interface TaskResult {
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface Task {
  id: string;
  pipelineId: string;
  name: string;
  priority: TaskPriority;
  status: TaskStatus;
  payload: TaskPayload;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  result?: TaskResult;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  status: PipelineStatus;
  taskIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  tasks?: Task[];
}

export interface WorkerInfo {
  id: string;
  status: 'IDLE' | 'BUSY' | 'STOPPED';
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalDurationMs: number;
  startedAt: string;
  lastActiveAt: string;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  throughputPerMinute: number;
}

export interface QueueStats {
  size: number;
  byPriority: Record<string, number>;
}

export interface HistoryPoint {
  minute: string;
  success: number;
  failed: number;
  avgDurationMs: number;
}

export interface DashboardStats {
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
    avgDurationMs: number;
    recentThroughput: number;
    successRate: number;
  };
  pipelines: {
    total: number;
    byStatus: Record<PipelineStatus, number>;
  };
  queue: QueueStats;
  workers: {
    total: number;
    active: number;
    idle: number;
    tasksCompleted: number;
    tasksFailed: number;
    avgDurationMs: number;
    throughputPerMinute: number;
  };
  history: HistoryPoint[];
}

// ─── WebSocket event types ────────────────────────────────────────────────────

export type WSEventType =
  | 'task:created'
  | 'task:queued'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled'
  | 'task:retrying'
  | 'pipeline:created'
  | 'pipeline:started'
  | 'pipeline:completed'
  | 'pipeline:failed'
  | 'pipeline:cancelled'
  | 'worker:stats'
  | 'queue:stats';

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
  timestamp: string;
}

// ─── API types ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface CreatePipelineInput {
  name: string;
  description?: string;
  tags?: string[];
  tasks: Array<{
    name: string;
    priority?: TaskPriority;
    handler: string;
    args?: Record<string, unknown>;
    dependsOn?: string[];
    maxRetries?: number;
  }>;
}
