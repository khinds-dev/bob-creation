import { Router, Request, Response, NextFunction } from 'express';
import { GetDashboardStats } from '../../application/GetDashboardStats';
import { WorkerPool } from '../../infrastructure/WorkerPool';

/**
 * DashboardController — REST endpoints for metrics and worker stats.
 */
export class DashboardController {
  public readonly router: Router;

  constructor(
    private readonly getDashboardStats: GetDashboardStats,
    private readonly workerPool: WorkerPool
  ) {
    this.router = Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.router.get('/stats', this.stats.bind(this));
    this.router.get('/workers', this.workers.bind(this));
  }

  private stats(_req: Request, res: Response, next: NextFunction): void {
    try {
      const stats = this.getDashboardStats.execute();
      res.json(stats);
    } catch (err) {
      next(err);
    }
  }

  private workers(_req: Request, res: Response, next: NextFunction): void {
    try {
      const workers = this.workerPool.getWorkers();
      const stats = this.workerPool.getStats();
      res.json({ workers, stats });
    } catch (err) {
      next(err);
    }
  }
}
