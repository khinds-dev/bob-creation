// ============================================================
// tests/integration/scheduler.test.ts
// Integration tests: end-to-end workflow execution
// ============================================================

import { Scheduler } from '../../src/core/scheduler';
import { MemoryStore } from '../../src/storage/memory-store';
import { EventBus } from '../../src/core/event-bus';
import { loadConfig, resetConfig } from '../../src/config';
import { DAGDefinition, JobState, EventType } from '../../src/types';
import { resetLogger } from '../../src/config/logger';

function makeTestConfig() {
  resetConfig();
  process.env['NODE_ENV'] = 'test';
  process.env['MAX_WORKERS'] = '5';
  process.env['DEFAULT_MAX_RETRIES'] = '2';
  process.env['DEFAULT_JOB_TIMEOUT_MS'] = '5000';
  process.env['DEFAULT_RETRY_BACKOFF_BASE_MS'] = '10';
  process.env['DEFAULT_RETRY_BACKOFF_MAX_MS'] = '100';
  process.env['PERSISTENCE_FLUSH_INTERVAL_MS'] = '60000';
  return loadConfig();
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForWorkflowState(
  scheduler: Scheduler,
  workflowId: string,
  expectedState: JobState,
  timeoutMs: number = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wf = await scheduler.getWorkflow(workflowId);
    if (wf?.state === expectedState) return;
    await wait(20);
  }
  const wf = await scheduler.getWorkflow(workflowId);
  throw new Error(`Workflow ${workflowId} did not reach ${expectedState}, current: ${wf?.state}`);
}

describe('Scheduler Integration', () => {
  let scheduler: Scheduler;
  let store: MemoryStore;
  let eventBus: EventBus;

  beforeEach(() => {
    resetLogger();
    EventBus.resetInstance();
    eventBus = EventBus.getInstance();
    store = new MemoryStore();
    const config = makeTestConfig();
    scheduler = new Scheduler({ config, storage: store, eventBus });

    // Register handlers
    scheduler.registerHandler('echo', async (ctx) => ({
      success: true,
      output: { echoed: ctx.input },
    }));
    scheduler.registerHandler('sleep', async (ctx) => {
      const ms = (ctx.input['ms'] as number) ?? 10;
      await wait(ms);
      return { success: true, output: { sleptMs: ms } };
    });
    scheduler.registerHandler('fail', async () => ({
      success: false,
      error: 'Intentional failure',
    }));
    scheduler.registerHandler('fail-once', async (ctx) => {
      if (ctx.retryCount === 0) {
        return { success: false, error: 'First attempt fails' };
      }
      return { success: true, output: { retriedSuccessfully: true } };
    });

    scheduler.start();
  });

  afterEach(async () => {
    await scheduler.stop();
    resetConfig();
    resetLogger();
    EventBus.resetInstance();
  });

  describe('Linear DAG execution', () => {
    it('executes a single-step DAG to COMPLETED', async () => {
      const dag: DAGDefinition = {
        id: 'single-step',
        name: 'Single Step',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('single-step');
      await waitForWorkflowState(scheduler, wf.id, JobState.COMPLETED);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.COMPLETED);
    });

    it('executes a 3-step linear chain', async () => {
      const dag: DAGDefinition = {
        id: 'linear-chain',
        name: 'Linear Chain',
        steps: [
          { id: 'a', name: 'A', handler: 'echo' },
          { id: 'b', name: 'B', handler: 'echo', dependsOn: ['a'] },
          { id: 'c', name: 'C', handler: 'echo', dependsOn: ['b'] },
        ],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('linear-chain');
      await waitForWorkflowState(scheduler, wf.id, JobState.COMPLETED);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.COMPLETED);
      expect(final?.steps['a'].state).toBe(JobState.COMPLETED);
      expect(final?.steps['b'].state).toBe(JobState.COMPLETED);
      expect(final?.steps['c'].state).toBe(JobState.COMPLETED);
    });
  });

  describe('Diamond DAG (parallel execution)', () => {
    it('executes diamond DAG to COMPLETED', async () => {
      const dag: DAGDefinition = {
        id: 'diamond',
        name: 'Diamond',
        steps: [
          { id: 'root', name: 'Root', handler: 'echo' },
          { id: 'left', name: 'Left', handler: 'echo', dependsOn: ['root'] },
          { id: 'right', name: 'Right', handler: 'echo', dependsOn: ['root'] },
          { id: 'merge', name: 'Merge', handler: 'echo', dependsOn: ['left', 'right'] },
        ],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('diamond');
      await waitForWorkflowState(scheduler, wf.id, JobState.COMPLETED, 8000);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.COMPLETED);
      expect(final?.steps['merge'].state).toBe(JobState.COMPLETED);
    });
  });

  describe('Failure and retry', () => {
    it('routes exhausted job to DLQ and fails workflow', async () => {
      const dag: DAGDefinition = {
        id: 'failing-dag',
        name: 'Failing DAG',
        steps: [
          {
            id: 'fail-step',
            name: 'Fail Step',
            handler: 'fail',
            retryPolicy: { maxRetries: 0 },
          },
        ],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('failing-dag');
      await waitForWorkflowState(scheduler, wf.id, JobState.FAILED, 6000);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.FAILED);

      const { items: dlqItems } = await scheduler.getDLQJobs();
      expect(dlqItems.length).toBeGreaterThan(0);
    });

    it('retries and eventually succeeds', async () => {
      const dag: DAGDefinition = {
        id: 'retry-dag',
        name: 'Retry DAG',
        steps: [
          {
            id: 'retry-step',
            name: 'Retry Step',
            handler: 'fail-once',
            retryPolicy: { maxRetries: 1 },
          },
        ],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('retry-dag');
      await waitForWorkflowState(scheduler, wf.id, JobState.COMPLETED, 8000);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.COMPLETED);
    });
  });

  describe('Cancellation', () => {
    it('cancels a pending workflow', async () => {
      // Use a slow handler to ensure we can cancel
      scheduler.registerHandler('slow', async () => {
        await wait(10000);
        return { success: true };
      });

      const dag: DAGDefinition = {
        id: 'slow-dag',
        name: 'Slow DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'slow' }],
      };
      await scheduler.registerDAG(dag);

      const wf = await scheduler.submitWorkflow('slow-dag');
      const cancelled = await scheduler.cancelWorkflow(wf.id);
      expect(cancelled).toBe(true);

      const final = await scheduler.getWorkflow(wf.id);
      expect(final?.state).toBe(JobState.CANCELLED);
    });

    it('returns false cancelling nonexistent workflow', async () => {
      const result = await scheduler.cancelWorkflow('nonexistent-id');
      expect(result).toBe(false);
    });

    it('returns false cancelling already-completed workflow', async () => {
      const dag: DAGDefinition = {
        id: 'complete-cancel',
        name: 'Complete Cancel',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      const wf = await scheduler.submitWorkflow('complete-cancel');
      await waitForWorkflowState(scheduler, wf.id, JobState.COMPLETED);
      const result = await scheduler.cancelWorkflow(wf.id);
      expect(result).toBe(false);
    });
  });

  describe('Events', () => {
    it('emits WORKFLOW_SUBMITTED event', async () => {
      const events: string[] = [];
      eventBus.subscribe(EventType.WORKFLOW_SUBMITTED, () => {
        events.push('submitted');
      });

      const dag: DAGDefinition = {
        id: 'event-dag',
        name: 'Event DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      await scheduler.submitWorkflow('event-dag');
      expect(events).toHaveLength(1);
    });

    it('emits WORKFLOW_COMPLETED event', async () => {
      return new Promise<void>(async (resolve) => {
        const dag: DAGDefinition = {
          id: 'complete-event-dag',
          name: 'Complete Event DAG',
          steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
        };
        await scheduler.registerDAG(dag);

        eventBus.subscribe(EventType.WORKFLOW_COMPLETED, () => resolve());
        await scheduler.submitWorkflow('complete-event-dag');
      });
    });
  });

  describe('Metrics', () => {
    it('returns engine metrics', async () => {
      const metrics = scheduler.getMetrics();
      expect(metrics).toHaveProperty('totalJobsSubmitted');
      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('activeWorkers');
      expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('increments workflow submission counter', async () => {
      const dag: DAGDefinition = {
        id: 'metrics-dag',
        name: 'Metrics DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      await scheduler.submitWorkflow('metrics-dag');

      const metrics = scheduler.getMetrics();
      expect(metrics.totalWorkflowsSubmitted).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DAG management', () => {
    it('registers and retrieves a DAG', async () => {
      const dag: DAGDefinition = {
        id: 'mgmt-dag',
        name: 'Mgmt DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      const retrieved = await scheduler.getDAG('mgmt-dag');
      expect(retrieved?.id).toBe('mgmt-dag');
    });

    it('throws SchedulerError when submitting unknown DAG', async () => {
      await expect(scheduler.submitWorkflow('nonexistent-dag')).rejects.toThrow('not found');
    });

    it('lists registered DAGs', async () => {
      const dag: DAGDefinition = {
        id: 'list-dag',
        name: 'List DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await scheduler.registerDAG(dag);
      const dags = await scheduler.listDAGs();
      expect(dags.length).toBeGreaterThanOrEqual(1);
    });
  });
});
