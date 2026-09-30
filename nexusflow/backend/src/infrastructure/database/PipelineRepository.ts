import { Pipeline, PipelineStatus } from '../../domain/Pipeline';
import { NotFoundError } from '../../shared/errors';
import { DatabaseConnection } from './DatabaseConnection';

/** Raw row shape returned by SQLite for pipeline table */
interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function rowToPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as PipelineStatus,
    taskIds: [], // populated separately when needed
    tags: JSON.parse(row.tags) as string[],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

/**
 * PipelineRepository — SQLite-backed persistence for Pipeline aggregates.
 * All methods are synchronous (better-sqlite3 is sync-by-design).
 */
export class PipelineRepository {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /** Persist a new pipeline */
  create(pipeline: Pipeline): Pipeline {
    this.db.db
      .prepare(
        `INSERT INTO pipelines (id, name, description, status, tags, created_at, updated_at)
         VALUES (@id, @name, @description, @status, @tags, @created_at, @updated_at)`
      )
      .run({
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description ?? null,
        status: pipeline.status,
        tags: JSON.stringify(pipeline.tags),
        created_at: pipeline.createdAt.toISOString(),
        updated_at: pipeline.updatedAt.toISOString(),
      });
    return pipeline;
  }

  /** Retrieve a pipeline by ID */
  findById(id: string): Pipeline | null {
    const row = this.db.db
      .prepare(`SELECT * FROM pipelines WHERE id = ?`)
      .get(id) as PipelineRow | undefined;
    return row ? rowToPipeline(row) : null;
  }

  /** Retrieve a pipeline or throw NotFoundError */
  findByIdOrThrow(id: string): Pipeline {
    const pipeline = this.findById(id);
    if (!pipeline) throw new NotFoundError('Pipeline', id);
    return pipeline;
  }

  /** List all pipelines, newest first */
  findAll(limit = 100, offset = 0): Pipeline[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM pipelines ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as PipelineRow[];
    return rows.map(rowToPipeline);
  }

  /** Count all pipelines */
  count(): number {
    const result = this.db.db
      .prepare(`SELECT COUNT(*) as c FROM pipelines`)
      .get() as { c: number };
    return result.c;
  }

  /** Update mutable pipeline fields */
  update(pipeline: Pipeline): Pipeline {
    this.db.db
      .prepare(
        `UPDATE pipelines
         SET name = @name, description = @description, status = @status,
             tags = @tags, updated_at = @updated_at,
             started_at = @started_at, completed_at = @completed_at
         WHERE id = @id`
      )
      .run({
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description ?? null,
        status: pipeline.status,
        tags: JSON.stringify(pipeline.tags),
        updated_at: pipeline.updatedAt.toISOString(),
        started_at: pipeline.startedAt?.toISOString() ?? null,
        completed_at: pipeline.completedAt?.toISOString() ?? null,
      });
    return pipeline;
  }

  /** Soft delete by cancelling */
  delete(id: string): void {
    this.db.db.prepare(`DELETE FROM pipelines WHERE id = ?`).run(id);
  }

  /** Count pipelines grouped by status */
  countByStatus(): Record<PipelineStatus, number> {
    const rows = this.db.db
      .prepare(`SELECT status, COUNT(*) as c FROM pipelines GROUP BY status`)
      .all() as Array<{ status: string; c: number }>;

    const counts = Object.values(PipelineStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<PipelineStatus, number>
    );
    for (const row of rows) {
      counts[row.status as PipelineStatus] = row.c;
    }
    return counts;
  }
}
