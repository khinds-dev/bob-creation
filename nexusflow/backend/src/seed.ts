/**
 * Seed script — populates the database with realistic demo data.
 * Run with: npm run seed
 */

import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import { PipelineRepository } from './infrastructure/database/PipelineRepository';
import { TaskRepository } from './infrastructure/database/TaskRepository';
import { PriorityQueue } from './infrastructure/PriorityQueue';
import { WebSocketGateway } from './infrastructure/websocket/WebSocketGateway';
import { CreatePipeline } from './application/CreatePipeline';
import { TaskPriority } from './domain/Task';
import { logger } from './shared/logger';

const PIPELINES = [
  {
    name: 'Daily ETL Pipeline',
    description: 'Extract, transform, and load daily sales data into the warehouse',
    tags: ['etl', 'daily', 'data'],
    tasks: [
      { name: 'Extract Sales Data', priority: TaskPriority.HIGH, handler: 'db-query', args: { table: 'sales', limit: 10000 }, dependsOn: [], maxRetries: 3 },
      { name: 'Extract User Events', priority: TaskPriority.HIGH, handler: 'db-query', args: { table: 'events', limit: 50000 }, dependsOn: [], maxRetries: 3 },
      { name: 'Transform Sales', priority: TaskPriority.NORMAL, handler: 'data-transform', args: { data: [], schema: 'sales_v2' }, dependsOn: ['Extract Sales Data'], maxRetries: 2 },
      { name: 'Transform Events', priority: TaskPriority.NORMAL, handler: 'data-transform', args: { data: [], schema: 'events_v1' }, dependsOn: ['Extract User Events'], maxRetries: 2 },
      { name: 'Load to Warehouse', priority: TaskPriority.CRITICAL, handler: 'simulate', args: { durationMs: 3000 }, dependsOn: ['Transform Sales', 'Transform Events'], maxRetries: 3 },
      { name: 'Send ETL Report', priority: TaskPriority.LOW, handler: 'send-notification', args: { channel: 'data-team' }, dependsOn: ['Load to Warehouse'], maxRetries: 1 },
    ],
  },
  {
    name: 'User Onboarding Pipeline',
    description: 'Automated onboarding sequence for new registered users',
    tags: ['users', 'onboarding', 'email'],
    tasks: [
      { name: 'Validate User Profile', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 200 }, dependsOn: [], maxRetries: 2 },
      { name: 'Create User Workspace', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 800 }, dependsOn: ['Validate User Profile'], maxRetries: 3 },
      { name: 'Send Welcome Email', priority: TaskPriority.NORMAL, handler: 'send-notification', args: { template: 'welcome' }, dependsOn: ['Validate User Profile'], maxRetries: 3 },
      { name: 'Provision API Key', priority: TaskPriority.NORMAL, handler: 'simulate', args: { durationMs: 400 }, dependsOn: ['Create User Workspace'], maxRetries: 2 },
      { name: 'Notify Slack', priority: TaskPriority.LOW, handler: 'send-notification', args: { channel: 'new-users' }, dependsOn: ['Create User Workspace'], maxRetries: 1 },
    ],
  },
  {
    name: 'ML Model Training',
    description: 'Train and deploy updated recommendation model',
    tags: ['ml', 'training', 'production'],
    tasks: [
      { name: 'Fetch Training Data', priority: TaskPriority.CRITICAL, handler: 'db-query', args: { limit: 100000 }, dependsOn: [], maxRetries: 3 },
      { name: 'Preprocess Features', priority: TaskPriority.HIGH, handler: 'data-transform', args: { normalize: true }, dependsOn: ['Fetch Training Data'], maxRetries: 2 },
      { name: 'Train Model', priority: TaskPriority.CRITICAL, handler: 'simulate', args: { durationMs: 5000 }, dependsOn: ['Preprocess Features'], maxRetries: 1 },
      { name: 'Evaluate Model', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 2000 }, dependsOn: ['Train Model'], maxRetries: 1 },
      { name: 'Deploy to Staging', priority: TaskPriority.HIGH, handler: 'api-call', args: { url: 'https://staging.api/deploy' }, dependsOn: ['Evaluate Model'], maxRetries: 2 },
      { name: 'Run A/B Test', priority: TaskPriority.NORMAL, handler: 'simulate', args: { durationMs: 3000 }, dependsOn: ['Deploy to Staging'], maxRetries: 1 },
      { name: 'Promote to Production', priority: TaskPriority.CRITICAL, handler: 'api-call', args: { url: 'https://api/promote' }, dependsOn: ['Run A/B Test'], maxRetries: 3 },
    ],
  },
  {
    name: 'Invoice Processing',
    description: 'Parse, validate, and reconcile uploaded invoices',
    tags: ['finance', 'invoices'],
    tasks: [
      { name: 'Parse Invoice PDF', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 600 }, dependsOn: [], maxRetries: 2 },
      { name: 'Validate Line Items', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 300, failRate: 0.1 }, dependsOn: ['Parse Invoice PDF'], maxRetries: 3 },
      { name: 'Match Purchase Orders', priority: TaskPriority.NORMAL, handler: 'db-query', args: {}, dependsOn: ['Validate Line Items'], maxRetries: 2 },
      { name: 'Post to Ledger', priority: TaskPriority.CRITICAL, handler: 'simulate', args: { durationMs: 1000 }, dependsOn: ['Match Purchase Orders'], maxRetries: 3 },
      { name: 'Archive Invoice', priority: TaskPriority.LOW, handler: 'simulate', args: { durationMs: 200 }, dependsOn: ['Post to Ledger'], maxRetries: 1 },
      { name: 'Email Confirmation', priority: TaskPriority.LOW, handler: 'send-notification', args: { template: 'invoice-processed' }, dependsOn: ['Post to Ledger'], maxRetries: 2 },
    ],
  },
  {
    name: 'Nightly Report Generation',
    description: 'Compile and distribute nightly business intelligence reports',
    tags: ['reporting', 'nightly', 'bi'],
    tasks: [
      { name: 'Aggregate Revenue Metrics', priority: TaskPriority.HIGH, handler: 'db-query', args: { period: 'daily' }, dependsOn: [], maxRetries: 2 },
      { name: 'Aggregate User Metrics', priority: TaskPriority.HIGH, handler: 'db-query', args: { period: 'daily' }, dependsOn: [], maxRetries: 2 },
      { name: 'Aggregate Ops Metrics', priority: TaskPriority.NORMAL, handler: 'db-query', args: { period: 'daily' }, dependsOn: [], maxRetries: 2 },
      { name: 'Build Revenue Chart', priority: TaskPriority.NORMAL, handler: 'data-transform', args: { type: 'chart' }, dependsOn: ['Aggregate Revenue Metrics'], maxRetries: 1 },
      { name: 'Build User Chart', priority: TaskPriority.NORMAL, handler: 'data-transform', args: { type: 'chart' }, dependsOn: ['Aggregate User Metrics'], maxRetries: 1 },
      { name: 'Compile PDF Report', priority: TaskPriority.HIGH, handler: 'simulate', args: { durationMs: 2000 }, dependsOn: ['Build Revenue Chart', 'Build User Chart', 'Aggregate Ops Metrics'], maxRetries: 2 },
      { name: 'Distribute Report', priority: TaskPriority.NORMAL, handler: 'send-notification', args: { channel: 'executives' }, dependsOn: ['Compile PDF Report'], maxRetries: 3 },
    ],
  },
];

async function seed(): Promise<void> {
  const db = DatabaseConnection.getInstance('./nexusflow-seed.db');
  const pipelineRepo = new PipelineRepository(db);
  const taskRepo = new TaskRepository(db);
  const queue = new PriorityQueue();

  // Minimal WS gateway mock for seeding
  const wsGateway = {
    broadcastTaskEvent: () => undefined,
    broadcastPipelineEvent: () => undefined,
    broadcastWorkerStats: () => undefined,
    broadcastQueueStats: () => undefined,
    broadcast: () => undefined,
    connectedClients: 0,
    close: async () => undefined,
  } as unknown as WebSocketGateway;

  const createPipeline = new CreatePipeline(pipelineRepo, taskRepo, queue, wsGateway);

  logger.info('Starting seed…');

  for (const pipeline of PIPELINES) {
    const result = await createPipeline.execute(pipeline);
    logger.info('Created pipeline', { name: result.pipeline.name, tasks: result.tasks.length });
  }

  const pipelineCount = pipelineRepo.count();
  const taskCounts = taskRepo.countByStatus();

  logger.info('Seed complete', {
    pipelines: pipelineCount,
    tasks: Object.values(taskCounts).reduce((a, b) => a + b, 0),
    tasksByStatus: taskCounts,
  });

  db.close();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
