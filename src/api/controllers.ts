// ============================================================
// src/api/controllers.ts
// Request handlers for all REST endpoints
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { Scheduler } from '../core/scheduler';
import { EventBus } from '../core/event-bus';
import { ApiError } from './middleware';
import { JobState } from '../types';

export class WorkflowController {
  constructor(private readonly scheduler: Scheduler) {}

  // POST /api/dags
  registerDAG = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.scheduler.registerDAG(req.body);
      res.status(201).json({ message: 'DAG registered', dagId: req.body.id });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'DAGParseError') {
        return next(new ApiError(400, err.message));
      }
      next(err);
    }
  };

  // GET /api/dags
  listDAGs = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dags = await this.scheduler.listDAGs();
      res.json({ data: dags, total: dags.length });
    } catch (err) {
      next(err);
    }
  };

  // GET /api/dags/:dagId
  getDAG = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dag = await this.scheduler.getDAG(req.params['dagId']!);
      if (!dag) return next(new ApiError(404, `DAG "${req.params['dagId']}" not found`));
      res.json(dag);
    } catch (err) {
      next(err);
    }
  };

  // DELETE /api/dags/:dagId
  deleteDAG = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deleted = await this.scheduler.deleteDAG(req.params['dagId']!);
      if (!deleted) return next(new ApiError(404, `DAG "${req.params['dagId']}" not found`));
      res.json({ message: 'DAG deleted' });
    } catch (err) {
      next(err);
    }
  };

  // POST /api/workflows
  submitWorkflow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { dagId, input, priority, metadata } = req.body;
      const workflow = await this.scheduler.submitWorkflow(dagId, input ?? {}, { priority, metadata });
      res.status(201).json(workflow);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'SchedulerError') {
        return next(new ApiError(404, err.message));
      }
      next(err);
    }
  };

  // GET /api/workflows
  listWorkflows = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const pageSize = parseInt(String(req.query['pageSize'] ?? '20'), 10);
      const offset = (page - 1) * pageSize;

      const { items, total } = await this.scheduler.listWorkflows({
        dagId: req.query['dagId'] as string | undefined,
        state: req.query['state'] as string | undefined,
        limit: pageSize,
        offset,
      });

      res.json({
        data: items,
        total,
        page,
        pageSize,
        hasMore: offset + items.length < total,
      });
    } catch (err) {
      next(err);
    }
  };

  // GET /api/workflows/:workflowId
  getWorkflow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workflow = await this.scheduler.getWorkflow(req.params['workflowId']!);
      if (!workflow) return next(new ApiError(404, `Workflow "${req.params['workflowId']}" not found`));
      res.json(workflow);
    } catch (err) {
      next(err);
    }
  };

  // DELETE /api/workflows/:workflowId (cancel)
  cancelWorkflow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cancelled = await this.scheduler.cancelWorkflow(req.params['workflowId']!);
      if (!cancelled) return next(new ApiError(404, `Workflow "${req.params['workflowId']}" not found or already terminal`));
      res.json({ message: 'Workflow cancelled' });
    } catch (err) {
      next(err);
    }
  };
}

export class JobController {
  constructor(private readonly scheduler: Scheduler) {}

  // GET /api/jobs
  listJobs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const pageSize = parseInt(String(req.query['pageSize'] ?? '20'), 10);
      const offset = (page - 1) * pageSize;

      const { items, total } = await this.scheduler.listJobs({
        workflowExecutionId: req.query['workflowId'] as string | undefined,
        state: req.query['state'] as string | undefined,
        limit: pageSize,
        offset,
      });

      res.json({
        data: items,
        total,
        page,
        pageSize,
        hasMore: offset + items.length < total,
      });
    } catch (err) {
      next(err);
    }
  };

  // GET /api/jobs/:jobId
  getJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await this.scheduler.getJob(req.params['jobId']!);
      if (!job) return next(new ApiError(404, `Job "${req.params['jobId']}" not found`));
      res.json(job);
    } catch (err) {
      next(err);
    }
  };

  // DELETE /api/jobs/:jobId (cancel)
  cancelJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cancelled = await this.scheduler.cancelJob(req.params['jobId']!);
      if (!cancelled) return next(new ApiError(404, `Job "${req.params['jobId']}" not found or already terminal`));
      res.json({ message: 'Job cancelled' });
    } catch (err) {
      next(err);
    }
  };

  // GET /api/dlq
  getDLQ = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = parseInt(String(req.query['page'] ?? '1'), 10);
      const pageSize = parseInt(String(req.query['pageSize'] ?? '20'), 10);
      const offset = (page - 1) * pageSize;

      const { items, total } = await this.scheduler.getDLQJobs(pageSize, offset);
      res.json({
        data: items,
        total,
        page,
        pageSize,
        hasMore: offset + items.length < total,
      });
    } catch (err) {
      next(err);
    }
  };
}

export class MetricsController {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly eventBus: EventBus
  ) {}

  // GET /api/metrics
  getMetrics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const metrics = this.scheduler.getMetrics();
      res.json(metrics);
    } catch (err) {
      next(err);
    }
  };

  // GET /api/events
  getEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = parseInt(String(req.query['limit'] ?? '100'), 10);
      const workflowId = req.query['workflowId'] as string | undefined;

      const events = workflowId
        ? this.eventBus.getEventsByWorkflow(workflowId)
        : this.eventBus.getRecentEvents(limit);

      res.json({ data: events, total: events.length });
    } catch (err) {
      next(err);
    }
  };

  // GET /api/health
  health = (_req: Request, res: Response): void => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };
}
