// ============================================================
// src/core/scheduler.ts
// Central workflow orchestration engine
// Coordinates DAG execution, job scheduling, retries, DLQ
// ============================================================

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  DAGDefinition,
  WorkflowExecution,
  Job,
  JobState,
  JobPriority,
  EventType,
  RetryPolicy,
  HandlerFunction,
  EngineMetrics,
} from '../types';
import { IStorage } from '../storage/storage-interface';
import { EventBus } from './event-bus';
import { WorkerPool } from './worker-pool';
import { PriorityQueue } from './priority-queue';
import { parseDAG, getReadySteps } from './dag-parser';
import { canRetry, computeBackoffDelayMs, getDefaultRetryPolicy, mergeRetryPolicy } from './retry-handler';
import { isTerminalState } from './state-machine';
import { getLogger } from '../config/logger';
import { AppConfig } from '../config';

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export interface SchedulerOptions {
  config: AppConfig;
  storage: IStorage;
  eventBus: EventBus;
}

export class Scheduler extends EventEmitter {
  private readonly storage: IStorage;
  private readonly eventBus: EventBus;
  private readonly workerPool: WorkerPool;
  private readonly jobQueue: PriorityQueue<Job>;
  private readonly config: AppConfig;
  private readonly handlers: Map<string, HandlerFunction> = new Map();
  private readonly activeWorkflows: Map<string, WorkflowExecution> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private drainInterval: NodeJS.Timeout | null = null;
  private startedAt: Date = new Date();

  // Metrics
  private metrics = {
    totalJobsSubmitted: 0,
    totalJobsCompleted: 0,
    totalJobsFailed: 0,
    totalJobsCancelled: 0,
    totalJobsDLQ: 0,
    totalWorkflowsSubmitted: 0,
    totalWorkflowsCompleted: 0,
    totalWorkflowsFailed: 0,
    jobDurations: [] as number[],
  };

  constructor(opts: SchedulerOptions) {
    super();
    this.config = opts.config;
    this.storage = opts.storage;
    this.eventBus = opts.eventBus;
    this.workerPool = new WorkerPool({ maxWorkers: opts.config.maxWorkers });
    this.jobQueue = new PriorityQueue<Job>();
  }

  // ── Handler Registry ─────────────────────────────────────────

  registerHandler(name: string, fn: HandlerFunction): void {
    this.handlers.set(name, fn);
    getLogger().info('Scheduler: registered handler', { name });
  }

  getRegisteredHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  // ── Lifecycle ────────────────────────────────────────────────

  start(): void {
    this.startedAt = new Date();

    // Periodically flush storage
    this.flushInterval = setInterval(async () => {
      try {
        await this.storage.flush();
      } catch (err) {
        getLogger().error('Scheduler: storage flush error', { error: String(err) });
      }
    }, this.config.persistenceFlushIntervalMs);

    // Drain queue loop — try to dispatch jobs when workers become free
    this.drainInterval = setInterval(() => this.drain(), 50);

    // Also drain when a worker becomes idle
    this.workerPool.on('workerIdle', () => this.drain());

    getLogger().info('Scheduler started', { maxWorkers: this.config.maxWorkers });
  }

  async stop(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.drainInterval) clearInterval(this.drainInterval);
    this.workerPool.removeAllListeners();
    await this.storage.flush();
    getLogger().info('Scheduler stopped');
  }

  // ── DAG Registration ─────────────────────────────────────────

  async registerDAG(definition: DAGDefinition): Promise<void> {
    // Validate by parsing (throws on invalid DAG)
    parseDAG(definition);
    await this.storage.saveDAG(definition);
    getLogger().info('Scheduler: DAG registered', { dagId: definition.id });
  }

  async getDAG(dagId: string): Promise<DAGDefinition | null> {
    return this.storage.getDAG(dagId);
  }

  async listDAGs(): Promise<DAGDefinition[]> {
    return this.storage.listDAGs();
  }

  async deleteDAG(dagId: string): Promise<boolean> {
    return this.storage.deleteDAG(dagId);
  }

  // ── Workflow Submission ──────────────────────────────────────

  async submitWorkflow(
    dagId: string,
    input: Record<string, unknown> = {},
    opts: {
      priority?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<WorkflowExecution> {
    const dag = await this.storage.getDAG(dagId);
    if (!dag) {
      throw new SchedulerError(`DAG "${dagId}" not found`);
    }

    const parsedDAG = parseDAG(dag);
    const executionId = uuidv4();

    const defaultRetryPolicy = getDefaultRetryPolicy({
      maxRetries: this.config.defaultMaxRetries,
      backoffBaseMs: this.config.defaultRetryBackoffBaseMs,
      backoffMaxMs: this.config.defaultRetryBackoffMaxMs,
    });

    // Build step executions
    const stepExecutions: WorkflowExecution['steps'] = {};
    for (const step of dag.steps) {
      const stepRetryPolicy: RetryPolicy = mergeRetryPolicy(
        mergeRetryPolicy(defaultRetryPolicy, dag.defaultRetryPolicy ?? {}),
        step.retryPolicy ?? {}
      );

      stepExecutions[step.id] = {
        stepId: step.id,
        workflowExecutionId: executionId,
        state: JobState.PENDING,
        input: { ...input, ...(step.input ?? {}) },
        retryCount: 0,
        retryPolicy: stepRetryPolicy,
        timeoutMs: step.timeoutMs ?? dag.defaultTimeoutMs ?? this.config.defaultJobTimeoutMs,
      };
    }

    const workflow: WorkflowExecution = {
      id: executionId,
      dagId,
      dagName: dag.name,
      state: JobState.PENDING,
      steps: stepExecutions,
      input,
      createdAt: new Date(),
      metadata: opts.metadata,
    };

    await this.storage.saveWorkflow(workflow);
    this.activeWorkflows.set(executionId, workflow);
    this.metrics.totalWorkflowsSubmitted++;

    this.eventBus.publish(EventType.WORKFLOW_SUBMITTED, {
      workflowId: executionId,
      dagId,
      input,
    }, { workflowExecutionId: executionId });

    // Enqueue initial ready steps
    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();
    const runningSteps = new Set<string>();
    const readyStepIds = getReadySteps(parsedDAG, completedSteps, failedSteps, runningSteps);

    const priority = opts.priority ?? JobPriority.NORMAL;

    for (const stepId of readyStepIds) {
      const step = dag.steps.find((s) => s.id === stepId)!;
      const stepExec = stepExecutions[stepId];
      const job = this.createJob(step.handler, stepId, executionId, stepExec.input, priority, stepExec.retryPolicy, stepExec.timeoutMs);
      await this.storage.saveJob(job);
      this.metrics.totalJobsSubmitted++;
      this.enqueueJob(job, priority);
    }

    // Transition workflow to RUNNING
    workflow.state = JobState.RUNNING;
    workflow.startedAt = new Date();
    await this.storage.saveWorkflow(workflow);

    this.eventBus.publish(EventType.WORKFLOW_STARTED, { workflowId: executionId }, { workflowExecutionId: executionId });

    getLogger().info('Scheduler: workflow submitted', { executionId, dagId });
    return workflow;
  }

  // ── Workflow/Job Cancellation ────────────────────────────────

  async cancelWorkflow(workflowId: string): Promise<boolean> {
    const workflow = await this.storage.getWorkflow(workflowId);
    if (!workflow) return false;
    if (isTerminalState(workflow.state)) return false;

    workflow.state = JobState.CANCELLED;
    workflow.completedAt = new Date();

    // Cancel all pending/running step executions
    for (const stepExec of Object.values(workflow.steps)) {
      if (!isTerminalState(stepExec.state)) {
        stepExec.state = JobState.CANCELLED;
      }
    }

    // Remove pending jobs from queue
    this.jobQueue.remove((j) => j.workflowExecutionId === workflowId);

    await this.storage.saveWorkflow(workflow);
    this.activeWorkflows.delete(workflowId);
    this.metrics.totalJobsCancelled++;

    this.eventBus.publish(EventType.WORKFLOW_CANCELLED, { workflowId }, { workflowExecutionId: workflowId });
    getLogger().info('Scheduler: workflow cancelled', { workflowId });
    return true;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.storage.getJob(jobId);
    if (!job) return false;
    if (isTerminalState(job.state)) return false;

    job.state = JobState.CANCELLED;
    job.completedAt = new Date();
    await this.storage.saveJob(job);

    this.jobQueue.remove((j) => j.id === jobId);
    this.metrics.totalJobsCancelled++;

    this.eventBus.publish(EventType.JOB_CANCELLED, { jobId }, {
      workflowExecutionId: job.workflowExecutionId,
      jobId,
      stepId: job.stepId,
    });
    return true;
  }

  // ── Query ────────────────────────────────────────────────────

  async getWorkflow(workflowId: string): Promise<WorkflowExecution | null> {
    return this.storage.getWorkflow(workflowId);
  }

  async listWorkflows(opts: {
    dagId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: WorkflowExecution[]; total: number }> {
    return this.storage.listWorkflows(opts);
  }

  async getJob(jobId: string): Promise<Job | null> {
    return this.storage.getJob(jobId);
  }

  async listJobs(opts: {
    workflowExecutionId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Job[]; total: number }> {
    return this.storage.listJobs(opts);
  }

  async getDLQJobs(limit?: number, offset?: number): Promise<{ items: Job[]; total: number }> {
    return this.storage.getDLQJobs(limit, offset);
  }

  getMetrics(): EngineMetrics {
    const durations = this.metrics.jobDurations;
    const avg = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    return {
      totalJobsSubmitted: this.metrics.totalJobsSubmitted,
      totalJobsCompleted: this.metrics.totalJobsCompleted,
      totalJobsFailed: this.metrics.totalJobsFailed,
      totalJobsCancelled: this.metrics.totalJobsCancelled,
      totalJobsDLQ: this.metrics.totalJobsDLQ,
      totalWorkflowsSubmitted: this.metrics.totalWorkflowsSubmitted,
      totalWorkflowsCompleted: this.metrics.totalWorkflowsCompleted,
      totalWorkflowsFailed: this.metrics.totalWorkflowsFailed,
      activeWorkers: this.workerPool.activeCount,
      idleWorkers: this.workerPool.availableCount,
      queueDepth: this.jobQueue.size,
      dlqDepth: 0, // fetched live
      averageJobDurationMs: avg,
      uptimeMs: Date.now() - this.startedAt.getTime(),
    };
  }

  getQueueDepth(): number {
    return this.jobQueue.size;
  }

  // ── Internal ─────────────────────────────────────────────────

  private createJob(
    handler: string,
    stepId: string,
    workflowExecutionId: string,
    input: Record<string, unknown>,
    priority: number,
    retryPolicy: RetryPolicy,
    timeoutMs: number,
    retryCount: number = 0
  ): Job {
    return {
      id: uuidv4(),
      workflowExecutionId,
      stepId,
      handler,
      input,
      state: JobState.PENDING,
      priority,
      retryCount,
      retryPolicy,
      timeoutMs,
      createdAt: new Date(),
      dlq: false,
    };
  }

  private enqueueJob(job: Job, priority: number): void {
    if (this.jobQueue.size >= this.config.maxQueueSize) {
      getLogger().warn('Scheduler: queue full, dropping job', { jobId: job.id });
      return;
    }
    this.jobQueue.enqueue(job, priority);
    getLogger().debug('Scheduler: job enqueued', { jobId: job.id, priority, queueSize: this.jobQueue.size });
  }

  private drain(): void {
    while (!this.jobQueue.isEmpty() && this.workerPool.canAcceptJob()) {
      const job = this.jobQueue.dequeue();
      if (!job) break;

      // Check if cancelled while in queue
      const wf = this.activeWorkflows.get(job.workflowExecutionId);
      if (wf && wf.state === JobState.CANCELLED) {
        continue;
      }

      // Fire and forget — all error handling inside dispatchJob
      this.dispatchJob(job).catch((err) => {
        getLogger().error('Scheduler: unhandled dispatchJob error', { error: String(err), jobId: job.id });
      });
    }
  }

  private async dispatchJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.handler);
    if (!handler) {
      getLogger().error('Scheduler: no handler registered', { handler: job.handler, jobId: job.id });
      await this.handleJobFailed(job, `No handler registered for "${job.handler}"`);
      return;
    }

    const onStateChange = async (
      j: Job,
      newState: JobState,
      error?: string,
      output?: Record<string, unknown>
    ): Promise<void> => {
      if (newState === JobState.RUNNING) {
        j.state = JobState.RUNNING;
        j.startedAt = new Date();
        await this.storage.saveJob(j);
        this.eventBus.publish(EventType.JOB_STARTED, { jobId: j.id }, {
          workflowExecutionId: j.workflowExecutionId,
          jobId: j.id,
          stepId: j.stepId,
        });
        this.updateStepState(j.workflowExecutionId, j.stepId, JobState.RUNNING);
      } else if (newState === JobState.COMPLETED) {
        const durationMs = j.startedAt ? Date.now() - j.startedAt.getTime() : 0;
        j.state = JobState.COMPLETED;
        j.completedAt = new Date();
        await this.storage.saveJob(j);

        this.metrics.totalJobsCompleted++;
        if (this.metrics.jobDurations.length > 10000) this.metrics.jobDurations.shift();
        this.metrics.jobDurations.push(durationMs);

        this.eventBus.publish(EventType.JOB_COMPLETED, { jobId: j.id, output }, {
          workflowExecutionId: j.workflowExecutionId,
          jobId: j.id,
          stepId: j.stepId,
        });
        await this.handleJobCompleted(j, output);
      } else if (newState === JobState.FAILED) {
        await this.handleJobFailed(j, error ?? 'Unknown error');
      }
    };

    await this.workerPool.executeJob(job, handler, (j, state, error, output) => {
      onStateChange(j, state, error, output).catch((e) => {
        getLogger().error('Scheduler: onStateChange error', { error: String(e) });
      });
    });
  }

  private async handleJobCompleted(
    job: Job,
    output?: Record<string, unknown>
  ): Promise<void> {
    const workflow = this.activeWorkflows.get(job.workflowExecutionId);
    if (!workflow) return;

    // Update step in workflow
    const stepExec = workflow.steps[job.stepId];
    if (stepExec) {
      stepExec.state = JobState.COMPLETED;
      stepExec.output = output;
      stepExec.completedAt = new Date();
    }

    this.eventBus.publish(EventType.STEP_COMPLETED, {
      workflowId: workflow.id,
      stepId: job.stepId,
      output,
    }, { workflowExecutionId: workflow.id, stepId: job.stepId });

    await this.storage.saveWorkflow(workflow);

    // Check if workflow is complete or if more steps can run
    await this.advanceWorkflow(workflow);
  }

  private async handleJobFailed(job: Job, error: string): Promise<void> {
    job.error = error;

    if (canRetry(job.retryCount, job.retryPolicy)) {
      // Schedule retry
      job.retryCount++;
      job.state = JobState.RETRYING;
      await this.storage.saveJob(job);

      this.updateStepState(job.workflowExecutionId, job.stepId, JobState.RETRYING);

      this.eventBus.publish(EventType.JOB_RETRYING, {
        jobId: job.id,
        retryCount: job.retryCount,
        error,
      }, { workflowExecutionId: job.workflowExecutionId, jobId: job.id, stepId: job.stepId });

      const delay = computeBackoffDelayMs(job.retryCount - 1, job.retryPolicy);
      getLogger().info('Scheduler: scheduling retry', {
        jobId: job.id,
        retryCount: job.retryCount,
        delayMs: delay,
      });

      setTimeout(async () => {
        // Create a new job for the retry (fresh ID)
        const retryJob = this.createJob(
          job.handler,
          job.stepId,
          job.workflowExecutionId,
          job.input,
          job.priority,
          job.retryPolicy,
          job.timeoutMs,
          job.retryCount
        );
        await this.storage.saveJob(retryJob);
        this.metrics.totalJobsSubmitted++;
        this.enqueueJob(retryJob, retryJob.priority);
      }, delay);
    } else {
      // Exhausted retries → FAILED
      job.state = JobState.FAILED;
      job.completedAt = new Date();
      await this.storage.saveJob(job);
      this.metrics.totalJobsFailed++;

      this.updateStepState(job.workflowExecutionId, job.stepId, JobState.FAILED, error);

      this.eventBus.publish(EventType.JOB_FAILED, { jobId: job.id, error }, {
        workflowExecutionId: job.workflowExecutionId,
        jobId: job.id,
        stepId: job.stepId,
      });

      // Route to DLQ
      job.dlq = true;
      await this.storage.pushToDLQ(job);
      this.metrics.totalJobsDLQ++;

      this.eventBus.publish(EventType.JOB_DLQ, { jobId: job.id, error }, {
        workflowExecutionId: job.workflowExecutionId,
        jobId: job.id,
        stepId: job.stepId,
      });

      // Fail the workflow
      await this.failWorkflow(job.workflowExecutionId, `Step "${job.stepId}" failed: ${error}`);
    }
  }

  private async advanceWorkflow(workflow: WorkflowExecution): Promise<void> {
    const dag = await this.storage.getDAG(workflow.dagId);
    if (!dag) return;

    const parsedDAG = parseDAG(dag);

    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();
    const runningSteps = new Set<string>();

    for (const [stepId, stepExec] of Object.entries(workflow.steps)) {
      if (stepExec.state === JobState.COMPLETED) completedSteps.add(stepId);
      else if (stepExec.state === JobState.FAILED) failedSteps.add(stepId);
      else if (stepExec.state === JobState.RUNNING || stepExec.state === JobState.RETRYING) {
        runningSteps.add(stepId);
      }
    }

    // Check if all steps complete
    if (completedSteps.size === dag.steps.length) {
      workflow.state = JobState.COMPLETED;
      workflow.completedAt = new Date();
      await this.storage.saveWorkflow(workflow);
      this.activeWorkflows.delete(workflow.id);
      this.metrics.totalWorkflowsCompleted++;

      this.eventBus.publish(EventType.WORKFLOW_COMPLETED, { workflowId: workflow.id }, {
        workflowExecutionId: workflow.id,
      });
      getLogger().info('Scheduler: workflow completed', { workflowId: workflow.id });
      return;
    }

    // Enqueue newly ready steps
    const readyStepIds = getReadySteps(parsedDAG, completedSteps, failedSteps, runningSteps);
    for (const stepId of readyStepIds) {
      const step = dag.steps.find((s) => s.id === stepId)!;
      const stepExec = workflow.steps[stepId];

      this.eventBus.publish(EventType.STEP_STARTED, {
        workflowId: workflow.id,
        stepId,
      }, { workflowExecutionId: workflow.id, stepId });

      const job = this.createJob(
        step.handler,
        stepId,
        workflow.id,
        stepExec.input,
        workflow.metadata?.['priority'] as number ?? JobPriority.NORMAL,
        stepExec.retryPolicy,
        stepExec.timeoutMs
      );
      await this.storage.saveJob(job);
      this.metrics.totalJobsSubmitted++;
      this.enqueueJob(job, job.priority);
    }
  }

  private async failWorkflow(workflowId: string, error: string): Promise<void> {
    const workflow = this.activeWorkflows.get(workflowId) ??
      await this.storage.getWorkflow(workflowId);
    if (!workflow || isTerminalState(workflow.state)) return;

    workflow.state = JobState.FAILED;
    workflow.error = error;
    workflow.completedAt = new Date();
    await this.storage.saveWorkflow(workflow);
    this.activeWorkflows.delete(workflowId);
    this.metrics.totalWorkflowsFailed++;

    this.eventBus.publish(EventType.WORKFLOW_FAILED, { workflowId, error }, {
      workflowExecutionId: workflowId,
    });
    getLogger().warn('Scheduler: workflow failed', { workflowId, error });
  }

  private updateStepState(
    workflowExecutionId: string,
    stepId: string,
    state: JobState,
    error?: string
  ): void {
    const workflow = this.activeWorkflows.get(workflowExecutionId);
    if (!workflow) return;
    const stepExec = workflow.steps[stepId];
    if (stepExec) {
      stepExec.state = state;
      if (error) stepExec.error = error;
      if (state === JobState.RUNNING) stepExec.startedAt = new Date();
      if (state === JobState.COMPLETED || state === JobState.FAILED) stepExec.completedAt = new Date();
    }
  }
}
