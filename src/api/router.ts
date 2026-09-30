// ============================================================
// src/api/router.ts
// Express router definitions wiring controllers to endpoints
// ============================================================

import { Router } from 'express';
import { Scheduler } from '../core/scheduler';
import { EventBus } from '../core/event-bus';
import { WorkflowController, JobController, MetricsController } from './controllers';
import {
  validateBody,
  validateQuery,
  dagSchema,
  submitWorkflowSchema,
  queryParamsSchema,
} from './middleware';

export function createRouter(scheduler: Scheduler, eventBus: EventBus): Router {
  const router = Router();
  const wfCtrl = new WorkflowController(scheduler);
  const jobCtrl = new JobController(scheduler);
  const metricsCtrl = new MetricsController(scheduler, eventBus);

  // ── Health ─────────────────────────────────────────────────
  router.get('/health', metricsCtrl.health);

  // ── Metrics & Events ───────────────────────────────────────
  router.get('/metrics', metricsCtrl.getMetrics);
  router.get('/events', metricsCtrl.getEvents);

  // ── DAG Management ─────────────────────────────────────────
  router.post('/dags', validateBody(dagSchema), wfCtrl.registerDAG);
  router.get('/dags', wfCtrl.listDAGs);
  router.get('/dags/:dagId', wfCtrl.getDAG);
  router.delete('/dags/:dagId', wfCtrl.deleteDAG);

  // ── Workflow Execution ──────────────────────────────────────
  router.post('/workflows', validateBody(submitWorkflowSchema), wfCtrl.submitWorkflow);
  router.get('/workflows', validateQuery(queryParamsSchema), wfCtrl.listWorkflows);
  router.get('/workflows/:workflowId', wfCtrl.getWorkflow);
  router.delete('/workflows/:workflowId', wfCtrl.cancelWorkflow);

  // ── Job Management ─────────────────────────────────────────
  router.get('/jobs', validateQuery(queryParamsSchema), jobCtrl.listJobs);
  router.get('/jobs/:jobId', jobCtrl.getJob);
  router.delete('/jobs/:jobId', jobCtrl.cancelJob);

  // ── Dead-Letter Queue ───────────────────────────────────────
  router.get('/dlq', jobCtrl.getDLQ);

  return router;
}
