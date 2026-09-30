import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityQueue } from '../src/infrastructure/PriorityQueue';
import { Task, TaskPriority, TaskStatus } from '../src/domain/Task';
import { v4 as uuidv4 } from 'uuid';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: uuidv4(),
    pipelineId: uuidv4(),
    name: 'Test Task',
    priority: TaskPriority.NORMAL,
    status: TaskStatus.QUEUED,
    payload: { handler: 'test', args: {} },
    dependsOn: [],
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('PriorityQueue', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('starts empty', () => {
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
  });

  it('enqueues and dequeues a single task', () => {
    const task = makeTask();
    queue.enqueue(task);
    expect(queue.size).toBe(1);
    expect(queue.peek()).toEqual(task);
    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(task);
    expect(queue.isEmpty).toBe(true);
  });

  it('dequeues in priority order (CRITICAL before HIGH before NORMAL before LOW)', () => {
    const low = makeTask({ priority: TaskPriority.LOW });
    const normal = makeTask({ priority: TaskPriority.NORMAL });
    const high = makeTask({ priority: TaskPriority.HIGH });
    const critical = makeTask({ priority: TaskPriority.CRITICAL });

    // Enqueue in reverse order to exercise heap invariant
    queue.enqueue(low);
    queue.enqueue(normal);
    queue.enqueue(critical);
    queue.enqueue(high);

    expect(queue.dequeue()!.priority).toBe(TaskPriority.CRITICAL);
    expect(queue.dequeue()!.priority).toBe(TaskPriority.HIGH);
    expect(queue.dequeue()!.priority).toBe(TaskPriority.NORMAL);
    expect(queue.dequeue()!.priority).toBe(TaskPriority.LOW);
  });

  it('applies FIFO ordering within the same priority level', () => {
    const t1 = makeTask({ priority: TaskPriority.HIGH, queuedAt: new Date(1000) });
    const t2 = makeTask({ priority: TaskPriority.HIGH, queuedAt: new Date(2000) });
    const t3 = makeTask({ priority: TaskPriority.HIGH, queuedAt: new Date(3000) });

    queue.enqueue(t3);
    queue.enqueue(t1);
    queue.enqueue(t2);

    expect(queue.dequeue()!.id).toBe(t1.id);
    expect(queue.dequeue()!.id).toBe(t2.id);
    expect(queue.dequeue()!.id).toBe(t3.id);
  });

  it('removes a task by ID and reheaps correctly', () => {
    const critical = makeTask({ priority: TaskPriority.CRITICAL });
    const normal = makeTask({ priority: TaskPriority.NORMAL });
    const low = makeTask({ priority: TaskPriority.LOW });

    queue.enqueue(critical);
    queue.enqueue(normal);
    queue.enqueue(low);

    const removed = queue.remove(critical.id);
    expect(removed).toBe(true);
    expect(queue.size).toBe(2);
    // Heap should still be valid
    expect(queue.dequeue()!.priority).toBe(TaskPriority.NORMAL);
    expect(queue.dequeue()!.priority).toBe(TaskPriority.LOW);
  });

  it('returns false when removing a non-existent task', () => {
    queue.enqueue(makeTask());
    expect(queue.remove('nonexistent-id')).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('snapshot returns all tasks sorted by priority', () => {
    for (let i = 0; i < 10; i++) {
      const priority = [TaskPriority.CRITICAL, TaskPriority.HIGH, TaskPriority.NORMAL, TaskPriority.LOW][
        Math.floor(Math.random() * 4)
      ]!;
      queue.enqueue(makeTask({ priority }));
    }

    const snapshot = queue.snapshot();
    expect(snapshot).toHaveLength(10);
    for (let i = 1; i < snapshot.length; i++) {
      expect(snapshot[i]!.priority).toBeGreaterThanOrEqual(snapshot[i - 1]!.priority);
    }
    // Original queue is unaffected
    expect(queue.size).toBe(10);
  });

  it('handles 1000 enqueue/dequeue cycles maintaining heap invariant', () => {
    const tasks: Task[] = Array.from({ length: 1000 }, () =>
      makeTask({
        priority: Math.floor(Math.random() * 4) as TaskPriority,
        queuedAt: new Date(Math.random() * 1_000_000),
      })
    );
    for (const t of tasks) queue.enqueue(t);

    let lastPriority = -1;
    while (!queue.isEmpty) {
      const t = queue.dequeue()!;
      expect(t.priority).toBeGreaterThanOrEqual(lastPriority);
      lastPriority = t.priority;
    }
  });
});
