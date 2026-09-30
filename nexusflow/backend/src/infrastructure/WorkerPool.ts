import { v4 as uuidv4 } from 'uuid';
import { Worker, WorkerStatus, WorkerPoolStats } from '../domain/Worker';
import { Task, TaskStatus, transitionTask } from '../domain/Task';
import { RetryPolicy, sleep } from './RetryPolicy';
import { PriorityQueue } from './PriorityQueue';
import { TaskRepository } from './database/TaskRepository';
import { WebSocketGateway } from './websocket/WebSocketGateway';
import { config } from '../shared/config';
import { logger } from '../shared/logger';

/** Function signature for a task handler registered in the handler registry */
export type TaskHandler = (
  args: Record<string, unknown>,
  signal: AbortSignal
) => Promise<unknown>;

/**
 * WorkerPool — manages a pool of concurrent workers that consume from the PriorityQueue.
 *
 * Workers are virtual (async tasks), not OS threads or child processes.
 * Concurrency is controlled by limiting the number of simultaneously executing
 * task handler invocations.
 */
export class WorkerPool {
  private readonly workers: Map<string, Worker> = new Map();
  private readonly abortControllers: Map<string, AbortController> = new Map();
  private readonly handlers: Map<string, TaskHandler> = new Map();
  private readonly retryPolicy: RetryPolicy;
  private readonly queue: PriorityQueue;
  private readonly taskRepo: TaskRepository;
  private readonly wsGateway: WebSocketGateway;
  private readonly concurrency: number;
  private running = false;
  private drainInterval: ReturnType<typeof setInterval> | null = null;
  /** Timestamps of recently completed tasks for throughput calculation */
  private completionTimestamps: number[] = [];

  constructor(
    queue: PriorityQueue,
    taskRepo: TaskRepository,
    wsGateway: WebSocketGateway,
    concurrency?: number
  ) {
    this.queue = queue;
    this.taskRepo = taskRepo;
    this.wsGateway = wsGateway;
    this.concurrency = concurrency ?? config.WORKER_CONCURRENCY;
    this.retryPolicy = new RetryPolicy(config.MAX_RETRY_ATTEMPTS);

    // Pre-create workers
    for (let i = 0; i < this.concurrency; i++) {
      const worker: Worker = {
        id: `worker-${uuidv4().slice(0, 8)}`,
        status: WorkerStatus.IDLE,
        tasksCompleted: 0,
        tasksFailed: 0,
        totalDurationMs: 0,
        startedAt: new Date(),
        lastActiveAt: new Date(),
      };
      this.workers.set(worker.id, worker);
    }
  }

  /** Register a task handler by its handler name */
  registerHandler(name: string, handler: TaskHandler): void {
    this.handlers.set(name, handler);
  }

  /** Start the pool's dispatch loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    // Poll the queue every 100ms for new tasks to dispatch to idle workers
    this.drainInterval = setInterval(() => void this.drain(), 100);
    logger.info('Worker pool started', { concurrency: this.concurrency });
  }

  /** Attempt to assign queued tasks to idle workers */
  private async drain(): Promise<void> {
    if (!this.running) return;

    const idleWorkers = [...this.workers.values()].filter(
      (w) => w.status === WorkerStatus.IDLE
    );

    for (const worker of idleWorkers) {
      const task = this.queue.dequeue();
      if (!task) break;
      void this.executeTask(worker, task);
    }

    // Broadcast live queue stats
    this.wsGateway.broadcastQueueStats(this.getQueueStats());
    this.wsGateway.broadcastWorkerStats(this.getStats());
  }

  private async executeTask(worker: Worker, task: Task): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    // Mark worker busy
    worker.status = WorkerStatus.BUSY;
    worker.currentTaskId = task.id;
    worker.lastActiveAt = new Date();

    // Transition task to RUNNING
    transitionTask(task, TaskStatus.RUNNING);
    this.taskRepo.update(task);
    this.wsGateway.broadcastTaskEvent('task:started', task);

    const startTime = Date.now();
    logger.info('Task started', { taskId: task.id, workerId: worker.id, attempt: task.retryCount + 1 });

    try {
      const handler = this.handlers.get(task.payload.handler);
      if (!handler) {
        throw new Error(`No handler registered for '${task.payload.handler}'`);
      }

      const output = await handler(task.payload.args, abortController.signal);
      const durationMs = Date.now() - startTime;

      task.result = { output, durationMs };
      transitionTask(task, TaskStatus.SUCCESS);
      this.taskRepo.update(task);
      this.wsGateway.broadcastTaskEvent('task:completed', task);

      worker.tasksCompleted++;
      worker.totalDurationMs += durationMs;
      this.completionTimestamps.push(Date.now());
      logger.info('Task completed', { taskId: task.id, durationMs });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Handle cancellation
      if (err instanceof DOMException && err.name === 'AbortError') {
        task.result = { error: 'Cancelled', durationMs };
        transitionTask(task, TaskStatus.CANCELLED);
        this.taskRepo.update(task);
        this.wsGateway.broadcastTaskEvent('task:cancelled', task);
        logger.info('Task cancelled', { taskId: task.id });
      } else if (this.retryPolicy.shouldRetry(task.retryCount)) {
        // Schedule retry
        task.retryCount++;
        const delayMs = this.retryPolicy.getDelayMs(task.retryCount - 1);
        task.result = { error: errorMessage, durationMs };
        // Transition back through FAILED → QUEUED for retry
        transitionTask(task, TaskStatus.FAILED);
        this.taskRepo.update(task);
        this.wsGateway.broadcastTaskEvent('task:retrying', task);
        logger.warn('Task failed, scheduling retry', {
          taskId: task.id,
          attempt: task.retryCount,
          delayMs,
          error: errorMessage,
        });
        // Re-enqueue after backoff delay
        void sleep(delayMs).then(() => {
          transitionTask(task, TaskStatus.QUEUED);
          this.taskRepo.update(task);
          this.queue.enqueue(task);
        });
      } else {
        task.result = { error: errorMessage, durationMs };
        transitionTask(task, TaskStatus.FAILED);
        this.taskRepo.update(task);
        this.wsGateway.broadcastTaskEvent('task:failed', task);
        worker.tasksFailed++;
        logger.error('Task failed permanently', { taskId: task.id, error: errorMessage });
      }
    } finally {
      this.abortControllers.delete(task.id);
      worker.status = WorkerStatus.IDLE;
      worker.currentTaskId = undefined;
      worker.lastActiveAt = new Date();
    }
  }

  /** Cancel a running task by aborting its execution context */
  cancelTask(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  getStats(): WorkerPoolStats {
    const workerList = [...this.workers.values()];
    const active = workerList.filter((w) => w.status === WorkerStatus.BUSY).length;
    const totalCompleted = workerList.reduce((s, w) => s + w.tasksCompleted, 0);
    const totalFailed = workerList.reduce((s, w) => s + w.tasksFailed, 0);
    const totalDuration = workerList.reduce((s, w) => s + w.totalDurationMs, 0);
    const totalTasks = totalCompleted + totalFailed;
    const avgDurationMs = totalTasks > 0 ? totalDuration / totalTasks : 0;

    // Throughput: completions in last 60 seconds
    const cutoff = Date.now() - 60_000;
    this.completionTimestamps = this.completionTimestamps.filter((t) => t > cutoff);
    const throughputPerMinute = this.completionTimestamps.length;

    return {
      totalWorkers: this.concurrency,
      activeWorkers: active,
      idleWorkers: this.concurrency - active,
      tasksCompleted: totalCompleted,
      tasksFailed: totalFailed,
      avgDurationMs: Math.round(avgDurationMs),
      throughputPerMinute,
    };
  }

  getQueueStats(): { size: number; byPriority: Record<string, number> } {
    const snapshot = this.queue.snapshot();
    const byPriority: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      NORMAL: 0,
      LOW: 0,
    };
    for (const task of snapshot) {
      const label = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'][task.priority] ?? 'NORMAL';
      byPriority[label]++;
    }
    return { size: snapshot.length, byPriority };
  }

  getWorkers(): Worker[] {
    return [...this.workers.values()];
  }

  /** Graceful shutdown: stop accepting new tasks and wait for running ones */
  async shutdown(): Promise<void> {
    this.running = false;
    if (this.drainInterval) clearInterval(this.drainInterval);

    // Abort all running tasks
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }

    // Wait up to 10 seconds for workers to become idle
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const busy = [...this.workers.values()].some((w) => w.status === WorkerStatus.BUSY);
      if (!busy) break;
      await sleep(100);
    }

    for (const worker of this.workers.values()) {
      worker.status = WorkerStatus.STOPPED;
    }
    logger.info('Worker pool shut down');
  }
}
