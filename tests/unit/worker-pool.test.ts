// ============================================================
// tests/unit/worker-pool.test.ts
// Unit tests for the WorkerPool concurrency controller
// ============================================================

import { WorkerPool } from '../../src/core/worker-pool';
import { Job, JobState, JobPriority, HandlerResult } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';
import { resetLogger } from '../../src/config/logger';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: uuidv4(),
    workflowExecutionId: 'wf-test',
    stepId: 'step-1',
    handler: 'echo',
    input: {},
    state: JobState.PENDING,
    priority: JobPriority.NORMAL,
    retryCount: 0,
    retryPolicy: { maxRetries: 3, backoffBaseMs: 100, backoffMaxMs: 1000, backoffMultiplier: 2 },
    timeoutMs: 5000,
    createdAt: new Date(),
    dlq: false,
    ...overrides,
  };
}

describe('WorkerPool', () => {
  beforeEach(() => {
    resetLogger();
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    resetLogger();
  });

  describe('construction', () => {
    it('initialises with correct worker count', () => {
      const pool = new WorkerPool({ maxWorkers: 4 });
      expect(pool.totalWorkers).toBe(4);
      expect(pool.availableCount).toBe(4);
      expect(pool.activeCount).toBe(0);
    });

    it('starts with all workers idle', () => {
      const pool = new WorkerPool({ maxWorkers: 3 });
      const workers = pool.getWorkers();
      expect(workers).toHaveLength(3);
      expect(workers.every((w) => w.state === 'idle')).toBe(true);
    });

    it('canAcceptJob returns true when workers available', () => {
      const pool = new WorkerPool({ maxWorkers: 2 });
      expect(pool.canAcceptJob()).toBe(true);
    });
  });

  describe('executeJob', () => {
    it('executes a successful handler and calls RUNNING then COMPLETED transitions', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();
      const states: JobState[] = [];

      const handler = async (): Promise<HandlerResult> => ({ success: true, output: { ok: true } });

      await pool.executeJob(job, handler, (j, state) => {
        states.push(state);
      });

      expect(states).toEqual([JobState.RUNNING, JobState.COMPLETED]);
    });

    it('executes a failing handler and calls RUNNING then FAILED transitions', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();
      const states: JobState[] = [];

      const handler = async (): Promise<HandlerResult> => ({ success: false, error: 'bad' });

      await pool.executeJob(job, handler, (j, state) => {
        states.push(state);
      });

      expect(states).toEqual([JobState.RUNNING, JobState.FAILED]);
    });

    it('handles a throwing handler and reports FAILED', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();
      const states: JobState[] = [];
      const errors: (string | undefined)[] = [];

      const handler = async (): Promise<HandlerResult> => {
        throw new Error('Unexpected crash');
      };

      await pool.executeJob(job, handler, (j, state, error) => {
        states.push(state);
        errors.push(error);
      });

      expect(states).toContain(JobState.FAILED);
      expect(errors.some((e) => e?.includes('Unexpected crash'))).toBe(true);
    });

    it('releases the worker slot after job completes', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();

      expect(pool.availableCount).toBe(1);

      await pool.executeJob(job, async () => ({ success: true }), () => {});

      expect(pool.availableCount).toBe(1);
      expect(pool.activeCount).toBe(0);
    });

    it('releases the worker slot after job fails', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();

      await pool.executeJob(job, async () => ({ success: false, error: 'oops' }), () => {});

      expect(pool.availableCount).toBe(1);
      expect(pool.activeCount).toBe(0);
    });

    it('releases the worker slot even when handler throws', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();

      await pool.executeJob(job, async () => { throw new Error('crash'); }, () => {});

      expect(pool.availableCount).toBe(1);
    });

    it('throws when no workers are available', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job1 = makeJob();
      const job2 = makeJob();

      // Start first job without awaiting to saturate the pool
      let resolveFirstJob!: (v: HandlerResult) => void;
      const blockingHandler = (): Promise<HandlerResult> =>
        new Promise((res) => { resolveFirstJob = res; });

      const firstJobPromise = pool.executeJob(job1, blockingHandler, () => {});

      // Small delay to ensure the first job has been picked up
      await new Promise((r) => setTimeout(r, 10));

      // Now try to execute a second job — should throw
      await expect(
        pool.executeJob(job2, async () => ({ success: true }), () => {})
      ).rejects.toThrow('No available workers');

      // Unblock first job
      resolveFirstJob({ success: true });
      await firstJobPromise;
    });

    it('times out a job and reports FAILED', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob({ timeoutMs: 50 }); // very short timeout
      const states: JobState[] = [];
      const errors: (string | undefined)[] = [];

      const neverResolves = (): Promise<HandlerResult> =>
        new Promise(() => {}); // intentionally hangs

      await pool.executeJob(job, neverResolves, (j, state, error) => {
        states.push(state);
        errors.push(error);
      });

      expect(states).toContain(JobState.FAILED);
      expect(errors.some((e) => e?.includes('timed out'))).toBe(true);
    });

    it('passes correct context to the handler', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob({ input: { testKey: 'testValue' }, retryCount: 2 });

      let capturedCtx: unknown;
      const handler = async (ctx: unknown): Promise<HandlerResult> => {
        capturedCtx = ctx;
        return { success: true };
      };

      await pool.executeJob(job, handler as never, () => {});

      const ctx = capturedCtx as {
        jobId: string;
        stepId: string;
        workflowExecutionId: string;
        input: Record<string, unknown>;
        retryCount: number;
      };
      expect(ctx.jobId).toBe(job.id);
      expect(ctx.stepId).toBe(job.stepId);
      expect(ctx.workflowExecutionId).toBe(job.workflowExecutionId);
      expect(ctx.input).toEqual(job.input);
      expect(ctx.retryCount).toBe(2);
    });

    it('emits workerIdle event when job finishes', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      const job = makeJob();
      const idleEvents: unknown[] = [];
      pool.on('workerIdle', (w) => idleEvents.push(w));

      await pool.executeJob(job, async () => ({ success: true }), () => {});

      expect(idleEvents).toHaveLength(1);
    });
  });

  describe('concurrent execution', () => {
    it('runs multiple jobs concurrently up to maxWorkers', async () => {
      const pool = new WorkerPool({ maxWorkers: 3 });
      const completed: string[] = [];

      const makeBlockingHandler = (id: string, delayMs: number) =>
        async (): Promise<HandlerResult> => {
          await new Promise((r) => setTimeout(r, delayMs));
          completed.push(id);
          return { success: true };
        };

      const job1 = makeJob({ id: 'j1' });
      const job2 = makeJob({ id: 'j2' });
      const job3 = makeJob({ id: 'j3' });

      await Promise.all([
        pool.executeJob(job1, makeBlockingHandler('j1', 20), () => {}),
        pool.executeJob(job2, makeBlockingHandler('j2', 10), () => {}),
        pool.executeJob(job3, makeBlockingHandler('j3', 5), () => {}),
      ]);

      // All three should have completed
      expect(completed).toHaveLength(3);
      expect(pool.activeCount).toBe(0);
    });
  });
});
