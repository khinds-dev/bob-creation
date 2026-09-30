import { Router, Request, Response, NextFunction } from 'express';
import { CreatePipeline } from '../../application/CreatePipeline';
import { PipelineRepository } from '../../infrastructure/database/PipelineRepository';
import { TaskRepository } from '../../infrastructure/database/TaskRepository';
import { NotFoundError } from '../../shared/errors';

/**
 * PipelineController — REST endpoints for Pipeline CRUD.
 */
export class PipelineController {
  public readonly router: Router;

  constructor(
    private readonly createPipeline: CreatePipeline,
    private readonly pipelineRepo: PipelineRepository,
    private readonly taskRepo: TaskRepository
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get('/', this.list.bind(this));
    this.router.post('/', this.create.bind(this));
    this.router.get('/:id', this.getById.bind(this));
    this.router.get('/:id/tasks', this.getTasks.bind(this));
    this.router.delete('/:id', this.deletePipeline.bind(this));
  }

  private list(req: Request, res: Response, next: NextFunction): void {
    try {
      const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
      const offset = Number(req.query['offset'] ?? 0);
      const pipelines = this.pipelineRepo.findAll(limit, offset);
      const total = this.pipelineRepo.count();
      res.json({ data: pipelines, total, limit, offset });
    } catch (err) {
      next(err);
    }
  }

  private async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = await this.createPipeline.execute(req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  private getById(req: Request, res: Response, next: NextFunction): void {
    try {
      const pipeline = this.pipelineRepo.findByIdOrThrow(req.params['id']!);
      const tasks = this.taskRepo.findByPipelineId(pipeline.id);
      res.json({ ...pipeline, tasks });
    } catch (err) {
      next(err);
    }
  }

  private getTasks(req: Request, res: Response, next: NextFunction): void {
    try {
      const pipeline = this.pipelineRepo.findByIdOrThrow(req.params['id']!);
      const tasks = this.taskRepo.findByPipelineId(pipeline.id);
      res.json({ data: tasks, total: tasks.length });
    } catch (err) {
      next(err);
    }
  }

  private deletePipeline(req: Request, res: Response, next: NextFunction): void {
    try {
      const id = req.params['id'];
      if (!id) throw new NotFoundError('Pipeline');
      this.pipelineRepo.findByIdOrThrow(id); // throws if not found
      this.pipelineRepo.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}
