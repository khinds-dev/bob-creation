import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Task, TaskPriority, TaskStatus } from '../domain/Task';
import { TaskRepository } from '../infrastructure/database/TaskRepository';
import { PipelineRepository } from '../infrastructure/database/PipelineRepository';
import { PriorityQueue } from '../infrastructure/PriorityQueue';
import { WebSocketGateway } from '../infrastructure/websocket/WebSocketGateway';
import { ConflictError, ValidationError } from '../shared/errors';

export const enqueueTaskSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().min(1).max(200),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.NORMAL),
  handler: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

export type EnqueueTaskInput = z.infer<typeof enqueueTaskSchema>;

/**
 * EnqueueTask use case — adds a single task to an existing pipeline and,
 * if it has no pending dependencies, places it immediately in the queue.
 */
export class EnqueueTask {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly pipelineRepo: PipelineRepository,
    private readonly queue: PriorityQueue,
    private readonly wsGateway: WebSocketGateway
  ) {}

  async execute(input: EnqueueTaskInput): Promise<Task> {
    const parsed = enqueueTaskSchema.safeParse(input);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.errors) {
        const key = issue.path.join('.');
        fields[key] = [...(fields[key] ?? []), issue.message];
      }
      throw new ValidationError('Invalid task input', fields);
    }

    const data = parsed.data;

    // Verify pipeline exists
    this.pipelineRepo.findByIdOrThrow(data.pipelineId);

    const now = new Date();
    const task: Task = {
      id: uuidv4(),
      pipelineId: data.pipelineId,
      name: data.name,
      priority: data.priority,
      status: TaskStatus.PENDING,
      payload: { handler: data.handler, args: data.args },
      dependsOn: data.dependsOn,
      retryCount: 0,
      maxRetries: data.maxRetries,
      createdAt: now,
      updatedAt: now,
    };

    this.taskRepo.create(task);
    this.wsGateway.broadcastTaskEvent('task:created', task);

    // Enqueue if no dependencies
    if (task.dependsOn.length === 0) {
      task.status = TaskStatus.QUEUED;
      task.queuedAt = new Date();
      task.updatedAt = new Date();
      this.taskRepo.update(task);
      this.queue.enqueue(task);
      this.wsGateway.broadcastTaskEvent('task:queued', task);
    }

    return task;
  }
}

/**
 * CancelTask use case — cancels a QUEUED or RUNNING task.
 */
export class CancelTask {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly queue: PriorityQueue,
    private readonly wsGateway: WebSocketGateway
  ) {}

  async execute(taskId: string): Promise<Task> {
    const task = this.taskRepo.findByIdOrThrow(taskId);

    if (task.status === TaskStatus.QUEUED) {
      // Remove from in-memory queue
      this.queue.remove(taskId);
      task.status = TaskStatus.CANCELLED;
      task.updatedAt = new Date();
      task.completedAt = new Date();
      this.taskRepo.update(task);
      this.wsGateway.broadcastTaskEvent('task:cancelled', task);
      return task;
    }

    if (task.status === TaskStatus.RUNNING) {
      // Worker will handle abort; just mark intent — actual cancel comes from WorkerPool
      return task;
    }

    throw new ConflictError(
      `Cannot cancel task in status '${task.status}'. Only QUEUED or RUNNING tasks can be cancelled.`
    );
  }
}

/**
 * RetryTask use case — manually re-queues a FAILED task.
 */
export class RetryTask {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly queue: PriorityQueue,
    private readonly wsGateway: WebSocketGateway
  ) {}

  async execute(taskId: string): Promise<Task> {
    const task = this.taskRepo.findByIdOrThrow(taskId);

    if (task.status !== TaskStatus.FAILED) {
      throw new ConflictError(
        `Cannot retry task in status '${task.status}'. Only FAILED tasks can be retried.`
      );
    }

    task.status = TaskStatus.QUEUED;
    task.queuedAt = new Date();
    task.updatedAt = new Date();
    task.result = undefined;
    this.taskRepo.update(task);
    this.queue.enqueue(task);
    this.wsGateway.broadcastTaskEvent('task:queued', task);
    return task;
  }
}
