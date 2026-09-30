// ============================================================
// tests/integration/api.test.ts
// Integration tests: HTTP REST API end-to-end
// ============================================================

import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../../src/api/app';
import { Scheduler } from '../../src/core/scheduler';
import { MemoryStore } from '../../src/storage/memory-store';
import { EventBus } from '../../src/core/event-bus';
import { loadConfig, resetConfig } from '../../src/config';
import { resetLogger } from '../../src/config/logger';
import { DAGDefinition, JobState } from '../../src/types';

function makeTestConfig() {
  resetConfig();
  process.env['NODE_ENV'] = 'test';
  process.env['MAX_WORKERS'] = '5';
  process.env['DEFAULT_MAX_RETRIES'] = '1';
  process.env['DEFAULT_JOB_TIMEOUT_MS'] = '5000';
  process.env['DEFAULT_RETRY_BACKOFF_BASE_MS'] = '10';
  process.env['DEFAULT_RETRY_BACKOFF_MAX_MS'] = '100';
  process.env['PERSISTENCE_FLUSH_INTERVAL_MS'] = '60000';
  return loadConfig();
}

const simpleDag: DAGDefinition = {
  id: 'api-test-dag',
  name: 'API Test DAG',
  steps: [
    { id: 'step-1', name: 'Step 1', handler: 'echo' },
    { id: 'step-2', name: 'Step 2', handler: 'echo', dependsOn: ['step-1'] },
  ],
};

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForState(
  app: Application,
  workflowId: string,
  state: JobState,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/workflows/${workflowId}`);
    if (res.body.state === state) return;
    await wait(25);
  }
  const res = await request(app).get(`/api/workflows/${workflowId}`);
  throw new Error(`Workflow ${workflowId} did not reach ${state}. Current: ${res.body.state}`);
}

describe('REST API Integration', () => {
  let app: Application;
  let scheduler: Scheduler;

  beforeEach(() => {
    resetLogger();
    EventBus.resetInstance();
    const eventBus = EventBus.getInstance();
    const store = new MemoryStore();
    const config = makeTestConfig();
    scheduler = new Scheduler({ config, storage: store, eventBus });

    scheduler.registerHandler('echo', async (ctx) => ({
      success: true,
      output: { echoed: ctx.input },
    }));
    scheduler.registerHandler('fail', async () => ({
      success: false,
      error: 'Intentional failure',
    }));

    scheduler.start();
    app = createApp(scheduler, eventBus, config);
  });

  afterEach(async () => {
    await scheduler.stop();
    resetConfig();
    resetLogger();
    EventBus.resetInstance();
  });

  // ── Health ──────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ── DAG endpoints ───────────────────────────────────────────

  describe('DAG CRUD', () => {
    it('POST /api/dags - registers a valid DAG', async () => {
      const res = await request(app).post('/api/dags').send(simpleDag);
      expect(res.status).toBe(201);
      expect(res.body.dagId).toBe('api-test-dag');
    });

    it('POST /api/dags - returns 400 for invalid DAG (no steps)', async () => {
      const res = await request(app).post('/api/dags').send({ id: 'bad', name: 'Bad' });
      expect(res.status).toBe(400);
    });

    it('POST /api/dags - returns 400 for DAG with cycle', async () => {
      const cyclicDag = {
        id: 'cyclic',
        name: 'Cyclic',
        steps: [
          { id: 'a', name: 'A', handler: 'echo', dependsOn: ['b'] },
          { id: 'b', name: 'B', handler: 'echo', dependsOn: ['a'] },
        ],
      };
      const res = await request(app).post('/api/dags').send(cyclicDag);
      expect(res.status).toBe(400);
    });

    it('GET /api/dags - lists DAGs', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      const res = await request(app).get('/api/dags');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/dags/:dagId - retrieves a specific DAG', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      const res = await request(app).get('/api/dags/api-test-dag');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('api-test-dag');
    });

    it('GET /api/dags/:dagId - returns 404 for missing DAG', async () => {
      const res = await request(app).get('/api/dags/nonexistent');
      expect(res.status).toBe(404);
    });

    it('DELETE /api/dags/:dagId - deletes a DAG', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      const res = await request(app).delete('/api/dags/api-test-dag');
      expect(res.status).toBe(200);
      const getRes = await request(app).get('/api/dags/api-test-dag');
      expect(getRes.status).toBe(404);
    });
  });

  // ── Workflow endpoints ──────────────────────────────────────

  describe('Workflow execution', () => {
    beforeEach(async () => {
      await request(app).post('/api/dags').send(simpleDag);
    });

    it('POST /api/workflows - submits a workflow', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'api-test-dag' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.state).toBe(JobState.RUNNING);
    });

    it('POST /api/workflows - returns 404 for unknown DAG', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'no-such-dag' });
      expect(res.status).toBe(404);
    });

    it('POST /api/workflows - returns 400 when dagId missing', async () => {
      const res = await request(app).post('/api/workflows').send({});
      expect(res.status).toBe(400);
    });

    it('GET /api/workflows - lists workflows', async () => {
      await request(app).post('/api/workflows').send({ dagId: 'api-test-dag' });
      const res = await request(app).get('/api/workflows');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/workflows/:id - retrieves workflow', async () => {
      const submitRes = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'api-test-dag' });
      const workflowId = submitRes.body.id;
      const res = await request(app).get(`/api/workflows/${workflowId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(workflowId);
    });

    it('GET /api/workflows/:id - returns 404 for missing', async () => {
      const res = await request(app).get('/api/workflows/nonexistent');
      expect(res.status).toBe(404);
    });

    it('workflow reaches COMPLETED state', async () => {
      const submitRes = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'api-test-dag' });
      const workflowId = submitRes.body.id;
      await waitForState(app, workflowId, JobState.COMPLETED, 8000);
      const res = await request(app).get(`/api/workflows/${workflowId}`);
      expect(res.body.state).toBe(JobState.COMPLETED);
    });

    it('DELETE /api/workflows/:id - cancels a workflow', async () => {
      // Register a slow dag
      scheduler.registerHandler('slow', async () => {
        await wait(10000);
        return { success: true };
      });
      await request(app).post('/api/dags').send({
        id: 'slow-dag-api',
        name: 'Slow',
        steps: [{ id: 's1', name: 'S1', handler: 'slow' }],
      });
      const submitRes = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'slow-dag-api' });
      const workflowId = submitRes.body.id;

      const cancelRes = await request(app).delete(`/api/workflows/${workflowId}`);
      expect(cancelRes.status).toBe(200);
    });
  });

  // ── Job endpoints ───────────────────────────────────────────

  describe('Job endpoints', () => {
    it('GET /api/jobs - lists jobs', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      await request(app).post('/api/workflows').send({ dagId: 'api-test-dag' });
      await wait(200); // Allow jobs to be created
      const res = await request(app).get('/api/jobs');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/jobs/:jobId - returns 404 for missing job', async () => {
      const res = await request(app).get('/api/jobs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('GET /api/jobs/:jobId - retrieves a real job', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      await request(app).post('/api/workflows').send({ dagId: 'api-test-dag' });
      await wait(200);
      const listRes = await request(app).get('/api/jobs');
      const jobs = listRes.body.data;
      if (jobs.length > 0) {
        const res = await request(app).get(`/api/jobs/${jobs[0].id}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(jobs[0].id);
      }
    });

    it('DELETE /api/jobs/:jobId - returns 404 for missing job', async () => {
      const res = await request(app).delete('/api/jobs/nonexistent-job');
      expect(res.status).toBe(404);
    });

    it('GET /api/jobs supports pagination', async () => {
      await request(app).post('/api/dags').send(simpleDag);
      const res = await request(app).get('/api/jobs?page=1&pageSize=5');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('pageSize', 5);
    });

    it('GET /api/jobs returns 400 for invalid query', async () => {
      const res = await request(app).get('/api/jobs?state=BOGUSSTATE');
      expect(res.status).toBe(400);
    });
  });

  // ── DLQ endpoint ────────────────────────────────────────────

  describe('GET /api/dlq', () => {
    it('returns DLQ jobs', async () => {
      const res = await request(app).get('/api/dlq');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('DLQ endpoint has pagination fields', async () => {
      const res = await request(app).get('/api/dlq');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('pageSize');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('hasMore');
    });
  });

  // ── Metrics endpoint ────────────────────────────────────────

  describe('GET /api/metrics', () => {
    it('returns engine metrics', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalJobsSubmitted');
      expect(res.body).toHaveProperty('activeWorkers');
      expect(res.body).toHaveProperty('queueDepth');
    });

    it('metrics include dlqDepth field', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('dlqDepth');
      expect(typeof res.body.dlqDepth).toBe('number');
    });

    it('metrics dlqDepth increases after workflow failure', async () => {
      // Register a dag that always fails with no retries
      await request(app).post('/api/dags').send({
        id: 'dlq-api-dag',
        name: 'DLQ API DAG',
        steps: [{
          id: 'fs',
          name: 'FS',
          handler: 'fail',
          retryPolicy: { maxRetries: 0 },
        }],
      });
      const submitRes = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'dlq-api-dag' });
      const workflowId = submitRes.body.id;
      await waitForState(app, workflowId, JobState.FAILED, 6000);

      const metricsRes = await request(app).get('/api/metrics');
      expect(metricsRes.body.dlqDepth).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Events endpoint ─────────────────────────────────────────

  describe('GET /api/events', () => {
    it('returns recent events', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/events with workflowId filter returns only that workflow events', async () => {
      // Register the DAG first (this describe block has no beforeEach for it)
      await request(app).post('/api/dags').send(simpleDag);
      const submitRes = await request(app)
        .post('/api/workflows')
        .send({ dagId: 'api-test-dag' });
      const workflowId = submitRes.body.id;
      await waitForState(app, workflowId, JobState.COMPLETED, 5000);

      const res = await request(app).get(`/api/events?workflowId=${workflowId}`);
      expect(res.status).toBe(200);
      const events = res.body.data;
      expect(events.length).toBeGreaterThan(0);
      for (const ev of events) {
        expect(ev.workflowExecutionId).toBe(workflowId);
      }
    });
  });

  // ── Workflows pagination ────────────────────────────────────

  describe('Workflow list pagination', () => {
    it('returns pagination fields', async () => {
      const res = await request(app).get('/api/workflows?page=1&pageSize=5');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('pageSize', 5);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('hasMore');
    });

    it('GET /api/workflows returns 400 for invalid state filter', async () => {
      const res = await request(app).get('/api/workflows?state=NOTASTATE');
      expect(res.status).toBe(400);
    });
  });

  // ── 404 handler ─────────────────────────────────────────────

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/api/this-does-not-exist');
      expect(res.status).toBe(404);
    });
  });
});
