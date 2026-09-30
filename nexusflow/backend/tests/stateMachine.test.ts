import { describe, it, expect } from 'vitest';
import { Task, TaskPriority, TaskStatus, transitionTask, isValidTransition, isTerminalStatus } from '../src/domain/Task';
import { v4 as uuidv4 } from 'uuid';

function makeTask(status: TaskStatus = TaskStatus.PENDING): Task {
  const now = new Date();
  return {
    id: uuidv4(),
    pipelineId: uuidv4(),
    name: 'SM Task',
    priority: TaskPriority.NORMAL,
    status,
    payload: { handler: 'test', args: {} },
    dependsOn: [],
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
    updatedAt: now,
  };
}

describe('Task State Machine', () => {
  it('allows PENDING → QUEUED', () => {
    const task = makeTask(TaskStatus.PENDING);
    expect(isValidTransition(task.status, TaskStatus.QUEUED)).toBe(true);
    transitionTask(task, TaskStatus.QUEUED);
    expect(task.status).toBe(TaskStatus.QUEUED);
    expect(task.queuedAt).toBeDefined();
  });

  it('allows QUEUED → RUNNING', () => {
    const task = makeTask(TaskStatus.QUEUED);
    transitionTask(task, TaskStatus.RUNNING);
    expect(task.status).toBe(TaskStatus.RUNNING);
    expect(task.startedAt).toBeDefined();
  });

  it('allows RUNNING → SUCCESS', () => {
    const task = makeTask(TaskStatus.RUNNING);
    transitionTask(task, TaskStatus.SUCCESS);
    expect(task.status).toBe(TaskStatus.SUCCESS);
    expect(task.completedAt).toBeDefined();
  });

  it('allows RUNNING → FAILED', () => {
    const task = makeTask(TaskStatus.RUNNING);
    transitionTask(task, TaskStatus.FAILED);
    expect(task.status).toBe(TaskStatus.FAILED);
  });

  it('allows RUNNING → CANCELLED', () => {
    const task = makeTask(TaskStatus.RUNNING);
    transitionTask(task, TaskStatus.CANCELLED);
    expect(task.status).toBe(TaskStatus.CANCELLED);
  });

  it('allows FAILED → QUEUED (retry)', () => {
    const task = makeTask(TaskStatus.FAILED);
    expect(isValidTransition(task.status, TaskStatus.QUEUED)).toBe(true);
    transitionTask(task, TaskStatus.QUEUED);
    expect(task.status).toBe(TaskStatus.QUEUED);
  });

  it('rejects PENDING → RUNNING (illegal jump)', () => {
    const task = makeTask(TaskStatus.PENDING);
    expect(isValidTransition(TaskStatus.PENDING, TaskStatus.RUNNING)).toBe(false);
    expect(() => transitionTask(task, TaskStatus.RUNNING)).toThrow();
  });

  it('rejects SUCCESS → QUEUED (no transition from terminal)', () => {
    const task = makeTask(TaskStatus.SUCCESS);
    expect(isValidTransition(TaskStatus.SUCCESS, TaskStatus.QUEUED)).toBe(false);
    expect(() => transitionTask(task, TaskStatus.QUEUED)).toThrow();
  });

  it('rejects CANCELLED → RUNNING', () => {
    expect(isValidTransition(TaskStatus.CANCELLED, TaskStatus.RUNNING)).toBe(false);
  });

  it('correctly identifies terminal states', () => {
    expect(isTerminalStatus(TaskStatus.SUCCESS)).toBe(true);
    expect(isTerminalStatus(TaskStatus.CANCELLED)).toBe(true);
    expect(isTerminalStatus(TaskStatus.FAILED)).toBe(false);
    expect(isTerminalStatus(TaskStatus.RUNNING)).toBe(false);
    expect(isTerminalStatus(TaskStatus.PENDING)).toBe(false);
    expect(isTerminalStatus(TaskStatus.QUEUED)).toBe(false);
  });

  it('updates updatedAt on every transition', () => {
    const task = makeTask(TaskStatus.PENDING);
    const before = task.updatedAt;
    // Small delay to ensure time difference
    task.createdAt.setTime(task.createdAt.getTime() - 1);
    transitionTask(task, TaskStatus.QUEUED);
    expect(task.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
