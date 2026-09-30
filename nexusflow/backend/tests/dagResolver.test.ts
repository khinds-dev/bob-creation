import { describe, it, expect } from 'vitest';
import { DAGResolver } from '../src/infrastructure/DAGResolver';
import { Task, TaskPriority, TaskStatus } from '../src/domain/Task';
import { v4 as uuidv4 } from 'uuid';

function makeTask(name: string, dependsOn: string[] = [], priority: TaskPriority = TaskPriority.NORMAL): Task {
  const now = new Date();
  return {
    id: uuidv4(),
    pipelineId: 'pipeline-1',
    name,
    priority,
    status: TaskStatus.PENDING,
    payload: { handler: 'test', args: {} },
    dependsOn,
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
    updatedAt: now,
  };
}

describe('DAGResolver', () => {
  it('resolves a linear chain into sequential levels', () => {
    const a = makeTask('A');
    const b = makeTask('B', [a.id]);
    const c = makeTask('C', [b.id]);

    const levels = DAGResolver.resolveExecutionLevels([a, b, c]);

    expect(levels).toHaveLength(3);
    expect(levels[0]!.map((t) => t.name)).toEqual(['A']);
    expect(levels[1]!.map((t) => t.name)).toEqual(['B']);
    expect(levels[2]!.map((t) => t.name)).toEqual(['C']);
  });

  it('resolves parallel tasks into a single level', () => {
    const a = makeTask('A');
    const b = makeTask('B');
    const c = makeTask('C');

    const levels = DAGResolver.resolveExecutionLevels([a, b, c]);

    expect(levels).toHaveLength(1);
    expect(levels[0]!).toHaveLength(3);
  });

  it('resolves a diamond DAG correctly', () => {
    // A → B, A → C, B → D, C → D
    const a = makeTask('A');
    const b = makeTask('B', [a.id]);
    const c = makeTask('C', [a.id]);
    const d = makeTask('D', [b.id, c.id]);

    const levels = DAGResolver.resolveExecutionLevels([a, b, c, d]);

    expect(levels).toHaveLength(3);
    expect(levels[0]!.map((t) => t.name)).toEqual(['A']);
    const level1Names = levels[1]!.map((t) => t.name).sort();
    expect(level1Names).toEqual(['B', 'C']);
    expect(levels[2]!.map((t) => t.name)).toEqual(['D']);
  });

  it('throws DomainError on a direct cycle (A → B → A)', () => {
    const a = makeTask('A');
    const b = makeTask('B', [a.id]);
    // Manually inject cycle
    a.dependsOn = [b.id] as string[];

    expect(() => DAGResolver.resolveExecutionLevels([a, b])).toThrow(/[Cc]yclic/);
  });

  it('throws DomainError on a transitive cycle (A → B → C → A)', () => {
    const a = makeTask('A');
    const b = makeTask('B', [a.id]);
    const c = makeTask('C', [b.id]);
    a.dependsOn = [c.id] as string[];

    expect(() => DAGResolver.resolveExecutionLevels([a, b, c])).toThrow(/[Cc]yclic/);
  });

  it('throws DomainError when a dependency references an unknown task', () => {
    const a = makeTask('A', ['unknown-task-id']);
    expect(() => DAGResolver.resolveExecutionLevels([a])).toThrow(/unknown/i);
  });

  it('getRunnableTasks returns only tasks with all dependencies completed', () => {
    const a = makeTask('A');
    const b = makeTask('B', [a.id]);
    const c = makeTask('C', [a.id]);
    const d = makeTask('D', [b.id, c.id]);
    const tasks = [a, b, c, d];

    // Initially nothing is completed
    const runnable0 = DAGResolver.getRunnableTasks(tasks, new Set());
    expect(runnable0.map((t) => t.name)).toEqual(['A']);

    // A is done
    const runnable1 = DAGResolver.getRunnableTasks(tasks, new Set([a.id]));
    expect(runnable1.map((t) => t.name).sort()).toEqual(['B', 'C']);

    // A, B, C done
    const runnable2 = DAGResolver.getRunnableTasks(tasks, new Set([a.id, b.id, c.id]));
    expect(runnable2.map((t) => t.name)).toEqual(['D']);
  });

  it('handles a single-node graph', () => {
    const a = makeTask('A');
    const levels = DAGResolver.resolveExecutionLevels([a]);
    expect(levels).toHaveLength(1);
    expect(levels[0]!).toHaveLength(1);
  });

  it('flattenOrder sorts within levels by priority', () => {
    const high = makeTask('High', [], TaskPriority.HIGH);
    const low = makeTask('Low', [], TaskPriority.LOW);
    const critical = makeTask('Critical', [], TaskPriority.CRITICAL);

    const order = DAGResolver.flattenOrder([low, high, critical]);
    expect(order.map((t) => t.name)).toEqual(['Critical', 'High', 'Low']);
  });
});
