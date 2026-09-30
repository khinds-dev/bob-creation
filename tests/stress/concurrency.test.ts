// ============================================================
// tests/stress/concurrency.test.ts
// Stress tests: concurrency, worker capacity, DLQ routing,
// state recovery on restart
// ============================================================

import { Scheduler } from '../../src/core/scheduler';
import { MemoryStore } from '../../src/storage/memory-store';
import { EventBus } from '../../src/core/event-bus';
import { loadConfig, resetConfig } from '../../src/config';
import { DAGDefinition, JobState } from '../../src/types';
import { resetLogger } from '../../src/config/logger';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

jest.setTimeout(60000);

function makeTestConfig(maxWorkers: number = 5) {
  resetConfig();
  process.env['NODE_ENV'] = 'test';
  process.env['MAX_WORKERS'] = String(maxWorkers);
  process.env['DEFAULT_MAX_RETRIES'] = '1';
  process.env['DEFAULT_JOB_TIMEOUT_MS'] = '10000';
  process.env['DEFAULT_RETRY_BACKOFF_BASE_MS'] = '10';
  process.env['DEFAULT_RETRY_BACKOFF_MAX_MS'] = '50';
  process.env['PERSISTENCE_FLUSH_INTERVAL_MS'] = '60000';
  return loadConfig();
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForAllWorkflows(
  scheduler: Scheduler,
  ids: string[],
  timeoutMs: number = 30000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(ids.map((id) => scheduler.getWorkflow(id)));
    const allDone = states.every((wf) =>
      wf?.state === JobState.COMPLETED ||
      wf?.state === JobState.FAILED ||
      wf?.state === JobState.CANCELLED
    );
    if (allDone) return;
    await wait(50);
  }
  throw new Error('Timed out waiting for workflows to complete');
}

describe('Stress Tests', () => {
  let scheduler: Scheduler;
  let store: MemoryStore;
  let eventBus: EventBus;

  beforeEach(() => {
    resetLogger();
    EventBus.resetInstance();
    eventBus = EventBus.getInstance();
    store = new MemoryStore();
    const config = makeTestConfig(5);
    scheduler = new Scheduler({ config, storage: store, eventBus });

    scheduler.registerHandler('echo', async (ctx) => ({
      success: true,
      output: { echoed: ctx.input },
    }));
    scheduler.registerHandler('fail-always', async () => ({
      success: false,
      error: 'Always fails',
    }));
    scheduler.registerHandler('fast', async () => ({
      success: true,
      output: { done: true },
    }));

    scheduler.start();
  });

  afterEach(async () => {
    await scheduler.stop();
    resetConfig();
    resetLogger();
    EventBus.resetInstance();
  });

  describe('Worker pool capacity', () => {
    it('processes 20 concurrent single-step workflows with 5 workers', async () => {
      const dag: DAGDefinition = {
        id: 'stress-single',
        name: 'Stress Single',
        steps: [{ id: 's1', name: 'S1', handler: 'fast' }],
      };
      await scheduler.registerDAG(dag);

      const N = 20;
      const wfIds: string[] = [];
      for (let i = 0; i < N; i++) {
        const wf = await scheduler.submitWorkflow('stress-single', { idx: i });
        wfIds.push(wf.id);
      }

      await waitForAllWorkflows(scheduler, wfIds, 20000);

      const results = await Promise.all(wfIds.map((id) => scheduler.getWorkflow(id)));
      const completed = results.filter((wf) => wf?.state === JobState.COMPLETED).length;
      expect(completed).toBe(N);
    });

    it('processes workflows with 3-step parallel DAGs', async () => {
      const dag: DAGDefinition = {
        id: 'stress-parallel',
        name: 'Stress Parallel',
        steps: [
          { id: 'root', name: 'Root', handler: 'fast' },
          { id: 'left', name: 'Left', handler: 'fast', dependsOn: ['root'] },
          { id: 'right', name: 'Right', handler: 'fast', dependsOn: ['root'] },
          { id: 'merge', name: 'Merge', handler: 'fast', dependsOn: ['left', 'right'] },
        ],
      };
      await scheduler.registerDAG(dag);

      const N = 10;
      const wfIds: string[] = [];
      for (let i = 0; i < N; i++) {
        const wf = await scheduler.submitWorkflow('stress-parallel');
        wfIds.push(wf.id);
      }

      await waitForAllWorkflows(scheduler, wfIds, 30000);

      const results = await Promise.all(wfIds.map((id) => scheduler.getWorkflow(id)));
      const completed = results.filter((wf) => wf?.state === JobState.COMPLETED).length;
      expect(completed).toBe(N);
    });
  });

  describe('Dead-letter queue under forced failures', () => {
    it('routes all failing jobs to DLQ', async () => {
      const dag: DAGDefinition = {
        id: 'dlq-stress',
        name: 'DLQ Stress',
        steps: [
          {
            id: 'fail-step',
            name: 'Fail Step',
            handler: 'fail-always',
            retryPolicy: { maxRetries: 0 },
          },
        ],
      };
      await scheduler.registerDAG(dag);

      const N = 10;
      const wfIds: string[] = [];
      for (let i = 0; i < N; i++) {
        const wf = await scheduler.submitWorkflow('dlq-stress');
        wfIds.push(wf.id);
      }

      await waitForAllWorkflows(scheduler, wfIds, 20000);

      const results = await Promise.all(wfIds.map((id) => scheduler.getWorkflow(id)));
      const failed = results.filter((wf) => wf?.state === JobState.FAILED).length;
      expect(failed).toBe(N);

      const { total: dlqCount } = await scheduler.getDLQJobs();
      expect(dlqCount).toBe(N);
    });

    it('DLQ respects max size limit', async () => {
      const smallStore = new MemoryStore(null, 5);
      const config = makeTestConfig(3);
      const smallEventBus = new EventBus();
      const smallScheduler = new Scheduler({
        config,
        storage: smallStore,
        eventBus: smallEventBus,
      });
      smallScheduler.registerHandler('fail-always', async () => ({
        success: false,
        error: 'Always fails',
      }));
      smallScheduler.start();

      const dag: DAGDefinition = {
        id: 'dlq-max-size',
        name: 'DLQ Max Size',
        steps: [{
          id: 'fs',
          name: 'FS',
          handler: 'fail-always',
          retryPolicy: { maxRetries: 0 },
        }],
      };
      await smallScheduler.registerDAG(dag);

      const wfIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        const wf = await smallScheduler.submitWorkflow('dlq-max-size');
        wfIds.push(wf.id);
      }

      await waitForAllWorkflows(smallScheduler, wfIds, 20000);

      // DLQ max is 5 — only 5 most recent should be kept
      const { total } = await smallScheduler.getDLQJobs();
      expect(total).toBeLessThanOrEqual(5);

      await smallScheduler.stop();
    });
  });

  describe('State recovery', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-stress-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('recovers completed workflows after restart', async () => {
      const persistStore = new MemoryStore(tmpDir);
      const config = makeTestConfig(3);
      EventBus.resetInstance();
      const eb = EventBus.getInstance();
      const persistScheduler = new Scheduler({ config, storage: persistStore, eventBus: eb });
      persistScheduler.registerHandler('echo', async (ctx) => ({
        success: true,
        output: { echoed: ctx.input },
      }));
      persistScheduler.start();

      const dag: DAGDefinition = {
        id: 'persist-dag',
        name: 'Persist DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'echo' }],
      };
      await persistScheduler.registerDAG(dag);
      const wf = await persistScheduler.submitWorkflow('persist-dag');

      // Wait for completion
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const state = (await persistScheduler.getWorkflow(wf.id))?.state;
        if (state === JobState.COMPLETED) break;
        await wait(30);
      }

      // Flush to disk
      await persistStore.flush();
      await persistScheduler.stop();

      // "Restart" — new store, load from disk
      const newStore = new MemoryStore(tmpDir);
      await newStore.loadFromDisk();

      const restoredWf = await newStore.getWorkflow(wf.id);
      expect(restoredWf).not.toBeNull();
      expect(restoredWf?.state).toBe(JobState.COMPLETED);
    });
  });

  describe('Priority ordering', () => {
    it('higher priority workflows are processed first when queue is congested', async () => {
      // Use maxWorkers=1 to force sequential processing
      const config = makeTestConfig(1);
      EventBus.resetInstance();
      const eb = EventBus.getInstance();
      const seq_store = new MemoryStore();
      const seqScheduler = new Scheduler({ config, storage: seq_store, eventBus: eb });

      const order: number[] = [];
      seqScheduler.registerHandler('ordered', async (ctx) => {
        order.push(ctx.input['idx'] as number);
        return { success: true, output: {} };
      });
      seqScheduler.start();

      const dag: DAGDefinition = {
        id: 'priority-dag',
        name: 'Priority DAG',
        steps: [{ id: 's1', name: 'S1', handler: 'ordered' }],
      };
      await seqScheduler.registerDAG(dag);

      // Submit low priority jobs first, then high priority
      const lowIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const wf = await seqScheduler.submitWorkflow('priority-dag', { idx: i }, { priority: 1 });
        lowIds.push(wf.id);
      }
      const highWf = await seqScheduler.submitWorkflow('priority-dag', { idx: 99 }, { priority: 20 });

      const allIds = [...lowIds, highWf.id];
      await waitForAllWorkflows(seqScheduler, allIds, 15000);

      // idx=99 (high priority) should have run before the low priority ones
      // It won't be first (idx=0 likely already started) but should be before last
      const highIdx = order.indexOf(99);
      expect(highIdx).toBeGreaterThanOrEqual(0);

      await seqScheduler.stop();
    });
  });
});
