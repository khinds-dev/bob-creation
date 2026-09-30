import express from 'express';
import cors from 'cors';
import { config } from './shared/config';
import { logger } from './shared/logger';

// Infrastructure
import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import { PipelineRepository } from './infrastructure/database/PipelineRepository';
import { TaskRepository } from './infrastructure/database/TaskRepository';
import { PriorityQueue } from './infrastructure/PriorityQueue';
import { WorkerPool } from './infrastructure/WorkerPool';
import { WebSocketGateway } from './infrastructure/websocket/WebSocketGateway';

// Application layer
import { CreatePipeline } from './application/CreatePipeline';
import { EnqueueTask, CancelTask, RetryTask } from './application/TaskUseCases';
import { GetDashboardStats } from './application/GetDashboardStats';

// Presentation layer
import { PipelineController } from './presentation/controllers/PipelineController';
import { TaskController } from './presentation/controllers/TaskController';
import { DashboardController } from './presentation/controllers/DashboardController';
import { AuthController } from './presentation/controllers/AuthController';
import {
  correlationMiddleware,
  requestLogger,
  errorHandler,
} from './presentation/middleware/requestMiddleware';
import { rateLimitMiddleware } from './presentation/middleware/rateLimitMiddleware';
import { authMiddleware } from './presentation/middleware/authMiddleware';

// ─── Built-in task handlers ───────────────────────────────────────────────────

function registerBuiltinHandlers(pool: WorkerPool): void {
  /**
   * simulate — generic handler that sleeps for a random duration, optionally failing.
   * Used by seed data and demos.
   */
  pool.registerHandler('simulate', async (args, signal) => {
    const durationMs = (args['durationMs'] as number | undefined) ?? 500 + Math.random() * 2000;
    const failRate = (args['failRate'] as number | undefined) ?? 0;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        if (Math.random() < failRate) reject(new Error('Simulated failure'));
        else resolve();
      }, durationMs);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return { processed: true, durationMs };
  });

  pool.registerHandler('data-transform', async (args, _signal) => {
    const input = (args['data'] as unknown[]) ?? [];
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 500));
    return { transformed: input.length, output: input.map((x) => ({ value: x, processed: true })) };
  });

  pool.registerHandler('api-call', async (args, signal) => {
    const url = (args['url'] as string | undefined) ?? 'https://example.com';
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 300 + Math.random() * 700);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return { url, status: 200, responseTime: Math.round(300 + Math.random() * 700) };
  });

  pool.registerHandler('db-query', async (_args, signal) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 100 + Math.random() * 400);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return { rows: Math.floor(Math.random() * 1000), queryTimeMs: Math.round(100 + Math.random() * 400) };
  });

  pool.registerHandler('send-notification', async (_args, _signal) => {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    return { sent: true, recipients: Math.floor(Math.random() * 10) + 1 };
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // ── Infrastructure setup ──
  const db = DatabaseConnection.getInstance();
  const pipelineRepo = new PipelineRepository(db);
  const taskRepo = new TaskRepository(db);
  const queue = new PriorityQueue();
  const wsGateway = new WebSocketGateway(config.WS_PORT);
  const workerPool = new WorkerPool(queue, taskRepo, wsGateway, config.WORKER_CONCURRENCY);

  registerBuiltinHandlers(workerPool);
  workerPool.start();

  // Reload queued tasks from DB on startup (in case of restart)
  const queuedTasks = taskRepo.findByStatus('QUEUED' as Parameters<typeof taskRepo.findByStatus>[0]);
  for (const task of queuedTasks) queue.enqueue(task);
  logger.info('Reloaded queued tasks from DB', { count: queuedTasks.length });

  // ── Application layer setup ──
  const createPipeline = new CreatePipeline(pipelineRepo, taskRepo, queue, wsGateway);
  const enqueueTask = new EnqueueTask(taskRepo, pipelineRepo, queue, wsGateway);
  const cancelTask = new CancelTask(taskRepo, queue, wsGateway);
  const retryTask = new RetryTask(taskRepo, queue, wsGateway);
  const getDashboardStats = new GetDashboardStats(taskRepo, pipelineRepo, workerPool);

  // ── Presentation layer setup ──
  const pipelineController = new PipelineController(createPipeline, pipelineRepo, taskRepo);
  const taskController = new TaskController(
    enqueueTask, cancelTask, retryTask, taskRepo, workerPool, queue
  );
  const dashboardController = new DashboardController(getDashboardStats, workerPool);

  // ── Express app ──
  const app = express();

  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);
  app.use(requestLogger);
  app.use(rateLimitMiddleware);

  // Auth routes (no auth guard)
  const authController = new AuthController(db);
  app.use('/api/auth', authController.router);

  // Protected API routes
  app.use('/api/pipelines', authMiddleware, pipelineController.router);
  app.use('/api/tasks', authMiddleware, taskController.router);
  app.use('/api/dashboard', authMiddleware, dashboardController.router);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('NexusFlow API server started', {
      port: config.PORT,
      wsPort: config.WS_PORT,
      env: config.NODE_ENV,
    });
  });

  // ── Graceful shutdown ──
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down gracefully…');
    server.close();
    await workerPool.shutdown();
    await wsGateway.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
