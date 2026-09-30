import { Task, TaskPriority, TaskStatus, TaskPayload, TaskResult } from '../../domain/Task';
import { NotFoundError } from '../../shared/errors';
import { DatabaseConnection } from './DatabaseConnection';

/** Raw row shape from SQLite task table */
interface TaskRow {
  id: string;
  pipeline_id: string;
  name: string;
  priority: number;
  status: string;
  payload: string;
  depends_on: string;
  retry_count: number;
  max_retries: number;
  result: string | null;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    payload: JSON.parse(row.payload) as TaskPayload,
    dependsOn: JSON.parse(row.depends_on) as string[],
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    result: row.result ? (JSON.parse(row.result) as TaskResult) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    queuedAt: row.queued_at ? new Date(row.queued_at) : undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

/**
 * TaskRepository — SQLite-backed persistence for Task entities.
 */
export class TaskRepository {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  create(task: Task): Task {
    this.db.db
      .prepare(
        `INSERT INTO tasks
         (id, pipeline_id, name, priority, status, payload, depends_on,
          retry_count, max_retries, result, created_at, updated_at,
          queued_at, started_at, completed_at)
         VALUES
         (@id, @pipeline_id, @name, @priority, @status, @payload, @depends_on,
          @retry_count, @max_retries, @result, @created_at, @updated_at,
          @queued_at, @started_at, @completed_at)`
      )
      .run({
        id: task.id,
        pipeline_id: task.pipelineId,
        name: task.name,
        priority: task.priority,
        status: task.status,
        payload: JSON.stringify(task.payload),
        depends_on: JSON.stringify(task.dependsOn),
        retry_count: task.retryCount,
        max_retries: task.maxRetries,
        result: task.result ? JSON.stringify(task.result) : null,
        created_at: task.createdAt.toISOString(),
        updated_at: task.updatedAt.toISOString(),
        queued_at: task.queuedAt?.toISOString() ?? null,
        started_at: task.startedAt?.toISOString() ?? null,
        completed_at: task.completedAt?.toISOString() ?? null,
      });
    return task;
  }

  findById(id: string): Task | null {
    const row = this.db.db
      .prepare(`SELECT * FROM tasks WHERE id = ?`)
      .get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  findByIdOrThrow(id: string): Task {
    const task = this.findById(id);
    if (!task) throw new NotFoundError('Task', id);
    return task;
  }

  findByPipelineId(pipelineId: string): Task[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM tasks WHERE pipeline_id = ? ORDER BY priority ASC, created_at ASC`)
      .all(pipelineId) as TaskRow[];
    return rows.map(rowToTask);
  }

  findByStatus(status: TaskStatus, limit = 100): Task[] {
    const rows = this.db.db
      .prepare(
        `SELECT * FROM tasks WHERE status = ?
         ORDER BY priority ASC, queued_at ASC LIMIT ?`
      )
      .all(status, limit) as TaskRow[];
    return rows.map(rowToTask);
  }

  findAll(limit = 100, offset = 0): Task[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as TaskRow[];
    return rows.map(rowToTask);
  }

  update(task: Task): Task {
    this.db.db
      .prepare(
        `UPDATE tasks
         SET pipeline_id = @pipeline_id, name = @name, priority = @priority,
             status = @status, payload = @payload, depends_on = @depends_on,
             retry_count = @retry_count, max_retries = @max_retries,
             result = @result, updated_at = @updated_at,
             queued_at = @queued_at, started_at = @started_at, completed_at = @completed_at
         WHERE id = @id`
      )
      .run({
        id: task.id,
        pipeline_id: task.pipelineId,
        name: task.name,
        priority: task.priority,
        status: task.status,
        payload: JSON.stringify(task.payload),
        depends_on: JSON.stringify(task.dependsOn),
        retry_count: task.retryCount,
        max_retries: task.maxRetries,
        result: task.result ? JSON.stringify(task.result) : null,
        updated_at: task.updatedAt.toISOString(),
        queued_at: task.queuedAt?.toISOString() ?? null,
        started_at: task.startedAt?.toISOString() ?? null,
        completed_at: task.completedAt?.toISOString() ?? null,
      });
    return task;
  }

  delete(id: string): void {
    this.db.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  }

  countByStatus(): Record<TaskStatus, number> {
    const rows = this.db.db
      .prepare(`SELECT status, COUNT(*) as c FROM tasks GROUP BY status`)
      .all() as Array<{ status: string; c: number }>;

    const counts = Object.values(TaskStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<TaskStatus, number>
    );
    for (const row of rows) {
      counts[row.status as TaskStatus] = row.c;
    }
    return counts;
  }

  /** Average duration (ms) of recently completed tasks */
  avgCompletedDurationMs(limit = 100): number {
    const result = this.db.db
      .prepare(
        `SELECT AVG(
           (julianday(completed_at) - julianday(started_at)) * 86400000
         ) as avg_ms
         FROM (
           SELECT started_at, completed_at FROM tasks
           WHERE status = 'SUCCESS' AND started_at IS NOT NULL AND completed_at IS NOT NULL
           ORDER BY completed_at DESC LIMIT ?
         )`
      )
      .get(limit) as { avg_ms: number | null };
    return Math.round(result.avg_ms ?? 0);
  }

  /** Throughput: count of completed tasks in the last `windowMs` milliseconds */
  recentThroughput(windowMs = 60_000): number {
    const since = new Date(Date.now() - windowMs).toISOString();
    const result = this.db.db
      .prepare(
        `SELECT COUNT(*) as c FROM tasks
         WHERE status IN ('SUCCESS', 'FAILED')
         AND completed_at > ?`
      )
      .get(since) as { c: number };
    return result.c;
  }

  /** Execution history for chart — per-minute success/failure counts */
  executionHistory(
    minutes = 60
  ): Array<{ minute: string; success: number; failed: number; avgDurationMs: number }> {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const rows = this.db.db
      .prepare(
        `SELECT
           strftime('%Y-%m-%dT%H:%M:00Z', completed_at) as minute,
           SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
           AVG(CASE WHEN status = 'SUCCESS' AND started_at IS NOT NULL
               THEN (julianday(completed_at) - julianday(started_at)) * 86400000
               ELSE NULL END) as avg_ms
         FROM tasks
         WHERE completed_at > ?
         GROUP BY minute
         ORDER BY minute ASC`
      )
      .all(since) as Array<{
        minute: string;
        success: number;
        failed: number;
        avg_ms: number | null;
      }>;

    return rows.map((r) => ({
      minute: r.minute,
      success: r.success,
      failed: r.failed,
      avgDurationMs: Math.round(r.avg_ms ?? 0),
    }));
  }
}
