import { Router, Request, Response, NextFunction } from 'express';
import { EnqueueTask, CancelTask, RetryTask } from '../../application/TaskUseCases';
import { TaskRepository } from '../../infrastructure/database/TaskRepository';
import { WorkerPool } from '../../infrastructure/WorkerPool';
import { PriorityQueue } from '../../infrastructure/PriorityQueue';

/**
 * TaskController — REST endpoints for Task management.
 */
export class TaskController {
  public readonly router: Router;

  constructor(
    private readonly enqueueTask: EnqueueTask,
    private readonly cancelTask: CancelTask,
    private readonly retryTask: RetryTask,
    private readonly taskRepo: TaskRepository,
    private readonly workerPool: WorkerPool,
    private readonly queue: PriorityQueue
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get('/', this.list.bind(this));
    this.router.post('/', this.create.bind(this));
    this.router.get('/queue', this.getQueue.bind(this));
    this.router.get('/:id', this.getById.bind(this));
    this.router.post('/:id/cancel', this.cancel.bind(this));
    this.router.post('/:id/retry', this.retry.bind(this));
    this.router.delete('/:id', this.deleteTask.bind(this));
  }

  private list(req: Request, res: Response, next: NextFunction): void {
    try {
      const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
      const offset = Number(req.query['offset'] ?? 0);
      const tasks = this.taskRepo.findAll(limit, offset);
      res.json({ data: tasks, total: tasks.length });
    } catch (err) {
      next(err);
    }
  }

  private async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const task = await this.enqueueTask.execute(req.body);
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  private getQueue(_req: Request, res: Response, next: NextFunction): void {
    try {
      const snapshot = this.queue.snapshot();
      const stats = this.workerPool.getQueueStats();
      res.json({ tasks: snapshot, stats });
    } catch (err) {
      next(err);
    }
  }

  private getById(req: Request, res: Response, next: NextFunction): void {
    try {
      const task = this.taskRepo.findByIdOrThrow(req.params['id']!);
      res.json(task);
    } catch (err) {
      next(err);
    }
  }

  private async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const taskId = req.params['id']!;
      // If running, abort via worker pool
      const aborted = this.workerPool.cancelTask(taskId);
      let task;
      if (!aborted) {
        task = await this.cancelTask.execute(taskId);
      } else {
        task = this.taskRepo.findByIdOrThrow(taskId);
      }
      res.json(task);
    } catch (err) {
      next(err);
    }
  }

  private async retry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const task = await this.retryTask.execute(req.params['id']!);
      res.json(task);
    } catch (err) {
      next(err);
    }
  }

  private deleteTask(req: Request, res: Response, next: NextFunction): void {
    try {
      const id = req.params['id']!;
      this.taskRepo.findByIdOrThrow(id);
      this.taskRepo.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
