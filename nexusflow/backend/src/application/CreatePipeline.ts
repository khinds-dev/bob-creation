import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Pipeline, PipelineStatus } from '../domain/Pipeline';
import { Task, TaskPriority, TaskStatus } from '../domain/Task';
import { PipelineRepository } from '../infrastructure/database/PipelineRepository';
import { TaskRepository } from '../infrastructure/database/TaskRepository';
import { PriorityQueue } from '../infrastructure/PriorityQueue';
import { DAGResolver } from '../infrastructure/DAGResolver';
import { WebSocketGateway } from '../infrastructure/websocket/WebSocketGateway';
import { ValidationError } from '../shared/errors';

const taskInputSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.NORMAL),
  handler: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).default([]),
  tasks: z.array(taskInputSchema).min(1),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

/**
 * CreatePipeline use case — validates input, constructs the Pipeline and Task
 * domain objects, validates the DAG, persists everything, and enqueues
 * immediately-runnable tasks.
 */
export class CreatePipeline {
  constructor(
    private readonly pipelineRepo: PipelineRepository,
    private readonly taskRepo: TaskRepository,
    private readonly queue: PriorityQueue,
    private readonly wsGateway: WebSocketGateway
  ) {}

  async execute(input: CreatePipelineInput): Promise<{ pipeline: Pipeline; tasks: Task[] }> {
    const parsed = createPipelineSchema.safeParse(input);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.errors) {
        const key = issue.path.join('.');
        fields[key] = [...(fields[key] ?? []), issue.message];
      }
      throw new ValidationError('Invalid pipeline input', fields);
    }

    const data = parsed.data;
    const now = new Date();
    const pipelineId = uuidv4();

    // First pass: assign IDs to establish the name→ID mapping
    const nameToId = new Map<string, string>();
    const rawTasks = data.tasks as Array<{ name: string; priority: TaskPriority; handler: string; args: Record<string, unknown>; dependsOn: string[]; maxRetries: number }>;
    const idMap = rawTasks.map((t) => { const id = uuidv4(); nameToId.set(t.name, id); return id; });

    // Second pass: build Task objects with resolved dependsOn
    const tasks: Task[] = rawTasks.map((t, i) => ({
      id: idMap[i]!,
      pipelineId,
      name: t.name,
      priority: t.priority,
      status: TaskStatus.PENDING,
      payload: { handler: t.handler, args: t.args },
      dependsOn: t.dependsOn.map((dep) => nameToId.get(dep) ?? dep),
      retryCount: 0,
      maxRetries: t.maxRetries,
      createdAt: now,
      updatedAt: now,
    } satisfies Task));

    // Validate the DAG — throws DomainError on cycle
    DAGResolver.validate(tasks);

    const pipeline: Pipeline = {
      id: pipelineId,
      name: data.name,
      description: data.description,
      status: PipelineStatus.IDLE,
      taskIds: tasks.map((t) => t.id),
      tags: data.tags,
      createdAt: now,
      updatedAt: now,
    };

    // Persist pipeline and tasks (synchronous SQLite)
    this.pipelineRepo.create(pipeline);
    for (const task of tasks) {
      this.taskRepo.create(task);
    }

    // Enqueue tasks with no dependencies immediately
    const completedIds = new Set<string>();
    const runnable = DAGResolver.getRunnableTasks(tasks, completedIds);
    for (const task of runnable) {
      task.status = TaskStatus.QUEUED;
      task.queuedAt = new Date();
      task.updatedAt = new Date();
      this.taskRepo.update(task);
      this.queue.enqueue(task);
      this.wsGateway.broadcastTaskEvent('task:queued', task);
    }

    this.wsGateway.broadcastPipelineEvent('pipeline:created', pipeline);

    return { pipeline, tasks };
  }
}
