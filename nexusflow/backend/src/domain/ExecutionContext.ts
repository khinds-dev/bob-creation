/**
 * ExecutionContext — value object capturing the runtime environment
 * in which a task executes. Passed to task handlers to provide
 * access to logger, correlation IDs, and task metadata.
 */
export interface ExecutionContext {
  readonly taskId: string;
  readonly pipelineId: string;
  readonly workerId: string;
  readonly correlationId: string;
  readonly attempt: number;
  readonly startedAt: Date;
  /** Abort signal — set when a task is cancelled mid-execution */
  readonly signal: AbortSignal;
}
