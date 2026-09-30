/**
 * Task priority levels — stored as numeric values for efficient heap comparison.
 * Lower numeric value = higher priority (CRITICAL runs first).
 */
export enum TaskPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

/**
 * Task lifecycle states modelling a finite state machine.
 *
 * Valid transitions:
 *   PENDING  → QUEUED
 *   QUEUED   → RUNNING | CANCELLED
 *   RUNNING  → SUCCESS | FAILED | CANCELLED
 *   FAILED   → QUEUED  (via retry)
 */
export enum TaskStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** All allowed state machine transitions */
const ALLOWED_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  [TaskStatus.PENDING, new Set([TaskStatus.QUEUED])],
  [TaskStatus.QUEUED, new Set([TaskStatus.RUNNING, TaskStatus.CANCELLED])],
  [TaskStatus.RUNNING, new Set([TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.CANCELLED])],
  [TaskStatus.FAILED, new Set([TaskStatus.QUEUED])],
  [TaskStatus.SUCCESS, new Set()],
  [TaskStatus.CANCELLED, new Set()],
]);

/** True if the status is a terminal (no further transitions possible) state */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.SUCCESS || status === TaskStatus.CANCELLED;
}

/**
 * Validate a state machine transition.
 * @returns true when the transition from → to is permitted
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

/** Payload describing the work a task should perform */
export interface TaskPayload {
  readonly handler: string;
  readonly args: Record<string, unknown>;
}

/** Immutable execution result attached to a completed task */
export interface TaskResult {
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

/**
 * Task — the core domain entity representing a unit of work within a pipeline.
 */
export interface Task {
  readonly id: string;
  readonly pipelineId: string;
  readonly name: string;
  readonly priority: TaskPriority;
  status: TaskStatus;
  readonly payload: TaskPayload;
  /** IDs of tasks that must complete before this task can run */
  readonly dependsOn: ReadonlyArray<string>;
  retryCount: number;
  readonly maxRetries: number;
  result?: TaskResult;
  readonly createdAt: Date;
  updatedAt: Date;
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Apply a state transition to a task, throwing if the transition is illegal.
 * Mutates the task's status and timestamps in-place.
 */
export function transitionTask(task: Task, to: TaskStatus): void {
  if (!isValidTransition(task.status, to)) {
    throw new Error(
      `Invalid task state transition: ${task.status} → ${to} for task '${task.id}'`
    );
  }
  const now = new Date();
  task.status = to;
  task.updatedAt = now;

  if (to === TaskStatus.QUEUED) task.queuedAt = now;
  if (to === TaskStatus.RUNNING) task.startedAt = now;
  if (to === TaskStatus.SUCCESS || to === TaskStatus.FAILED || to === TaskStatus.CANCELLED) {
    task.completedAt = now;
  }
}
