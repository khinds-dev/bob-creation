// ============================================================
// tests/unit/memory-store.test.ts
// Unit tests for in-memory storage
// ============================================================

import { MemoryStore } from '../../src/storage/memory-store';
import { WorkflowExecution, Job, DAGDefinition, JobState, JobPriority } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function makeDAG(id: string = 'dag-1'): DAGDefinition {
  return {
    id,
    name: `DAG ${id}`,
    steps: [{ id: 'step-1', name: 'Step 1', handler: 'echo' }],
  };
}

function makeWorkflow(id: string = uuidv4(), dagId: string = 'dag-1'): WorkflowExecution {
  return {
    id,
    dagId,
    dagName: 'Test DAG',
    state: JobState.PENDING,
    steps: {},
    input: {},
    createdAt: new Date(),
  };
}

function makeJob(id: string = uuidv4(), workflowId: string = 'wf-1'): Job {
  return {
    id,
    workflowExecutionId: workflowId,
    stepId: 'step-1',
    handler: 'echo',
    input: {},
    state: JobState.PENDING,
    priority: JobPriority.NORMAL,
    retryCount: 0,
    retryPolicy: { maxRetries: 3, backoffBaseMs: 1000, backoffMaxMs: 30000, backoffMultiplier: 2 },
    timeoutMs: 30000,
    createdAt: new Date(),
    dlq: false,
  };
}

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('DAG operations', () => {
    it('saves and retrieves a DAG', async () => {
      const dag = makeDAG();
      await store.saveDAG(dag);
      const retrieved = await store.getDAG(dag.id);
      expect(retrieved).toEqual(dag);
    });

    it('returns null for missing DAG', async () => {
      expect(await store.getDAG('nonexistent')).toBeNull();
    });

    it('lists all DAGs', async () => {
      await store.saveDAG(makeDAG('dag-1'));
      await store.saveDAG(makeDAG('dag-2'));
      const dags = await store.listDAGs();
      expect(dags).toHaveLength(2);
    });

    it('deletes a DAG', async () => {
      await store.saveDAG(makeDAG('dag-to-delete'));
      const deleted = await store.deleteDAG('dag-to-delete');
      expect(deleted).toBe(true);
      expect(await store.getDAG('dag-to-delete')).toBeNull();
    });

    it('returns false when deleting nonexistent DAG', async () => {
      expect(await store.deleteDAG('nonexistent')).toBe(false);
    });

    it('overwrites existing DAG', async () => {
      const dag = makeDAG('dag-1');
      await store.saveDAG(dag);
      const updated = { ...dag, name: 'Updated Name' };
      await store.saveDAG(updated);
      const retrieved = await store.getDAG('dag-1');
      expect(retrieved?.name).toBe('Updated Name');
    });
  });

  describe('Workflow operations', () => {
    it('saves and retrieves a workflow', async () => {
      const wf = makeWorkflow('wf-1');
      await store.saveWorkflow(wf);
      const retrieved = await store.getWorkflow('wf-1');
      expect(retrieved?.id).toBe('wf-1');
    });

    it('returns null for missing workflow', async () => {
      expect(await store.getWorkflow('nonexistent')).toBeNull();
    });

    it('lists workflows with filters', async () => {
      await store.saveWorkflow({ ...makeWorkflow('wf-1', 'dag-a'), state: JobState.COMPLETED });
      await store.saveWorkflow({ ...makeWorkflow('wf-2', 'dag-a'), state: JobState.RUNNING });
      await store.saveWorkflow({ ...makeWorkflow('wf-3', 'dag-b'), state: JobState.COMPLETED });

      const { items: all } = await store.listWorkflows();
      expect(all).toHaveLength(3);

      const { items: byDag } = await store.listWorkflows({ dagId: 'dag-a' });
      expect(byDag).toHaveLength(2);

      const { items: byState } = await store.listWorkflows({ state: 'COMPLETED' });
      expect(byState).toHaveLength(2);

      const { items: combined } = await store.listWorkflows({ dagId: 'dag-a', state: 'COMPLETED' });
      expect(combined).toHaveLength(1);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.saveWorkflow(makeWorkflow(`wf-${i}`));
      }
      const { items, total } = await store.listWorkflows({ limit: 2, offset: 0 });
      expect(items).toHaveLength(2);
      expect(total).toBe(5);
    });

    it('deletes a workflow', async () => {
      await store.saveWorkflow(makeWorkflow('wf-del'));
      expect(await store.deleteWorkflow('wf-del')).toBe(true);
      expect(await store.getWorkflow('wf-del')).toBeNull();
    });
  });

  describe('Job operations', () => {
    it('saves and retrieves a job', async () => {
      const job = makeJob('job-1');
      await store.saveJob(job);
      expect((await store.getJob('job-1'))?.id).toBe('job-1');
    });

    it('returns null for missing job', async () => {
      expect(await store.getJob('nonexistent')).toBeNull();
    });

    it('lists jobs by workflowExecutionId', async () => {
      await store.saveJob(makeJob('j1', 'wf-a'));
      await store.saveJob(makeJob('j2', 'wf-a'));
      await store.saveJob(makeJob('j3', 'wf-b'));

      const { items } = await store.listJobs({ workflowExecutionId: 'wf-a' });
      expect(items).toHaveLength(2);
    });
  });

  describe('DLQ operations', () => {
    it('pushes and retrieves DLQ jobs', async () => {
      const job = makeJob('dlq-1');
      await store.pushToDLQ(job);
      const { items, total } = await store.getDLQJobs();
      expect(total).toBe(1);
      expect(items[0].id).toBe('dlq-1');
    });

    it('respects DLQ max size', async () => {
      const limitedStore = new MemoryStore(null, 3);
      for (let i = 0; i < 5; i++) {
        await limitedStore.pushToDLQ(makeJob(`dlq-${i}`));
      }
      expect(limitedStore.getDLQCount()).toBe(3);
    });

    it('removes a job from DLQ', async () => {
      const job = makeJob('dlq-remove');
      await store.pushToDLQ(job);
      expect(await store.removeFromDLQ('dlq-remove')).toBe(true);
      expect(store.getDLQCount()).toBe(0);
    });

    it('returns false removing nonexistent DLQ job', async () => {
      expect(await store.removeFromDLQ('nonexistent')).toBe(false);
    });
  });

  describe('Snapshot & Restore', () => {
    it('creates a snapshot', async () => {
      await store.saveWorkflow(makeWorkflow('wf-snap'));
      await store.saveJob(makeJob('job-snap', 'wf-snap'));
      const snap = await store.snapshot();
      expect(snap.workflows['wf-snap']).toBeDefined();
      expect(snap.jobs['job-snap']).toBeDefined();
      expect(snap.version).toBe(1);
    });

    it('restores from snapshot', async () => {
      await store.saveWorkflow(makeWorkflow('wf-restore'));
      const snap = await store.snapshot();

      const newStore = new MemoryStore();
      await newStore.restore(snap);
      expect(await newStore.getWorkflow('wf-restore')).not.toBeNull();
    });

    it('restores DLQ from snapshot', async () => {
      await store.pushToDLQ(makeJob('dlq-snap'));
      const snap = await store.snapshot();

      const newStore = new MemoryStore();
      await newStore.restore(snap);
      expect(newStore.getDLQCount()).toBe(1);
    });
  });

  describe('Disk persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('flushes and loads from disk', async () => {
      const diskStore = new MemoryStore(tmpDir);
      await diskStore.saveWorkflow(makeWorkflow('wf-disk'));
      await diskStore.flush();

      const loadStore = new MemoryStore(tmpDir);
      const loaded = await loadStore.loadFromDisk();
      expect(loaded).toBe(true);
      expect(await loadStore.getWorkflow('wf-disk')).not.toBeNull();
    });

    it('returns false when no snapshot on disk', async () => {
      const freshStore = new MemoryStore(tmpDir);
      expect(await freshStore.loadFromDisk()).toBe(false);
    });
  });
});
