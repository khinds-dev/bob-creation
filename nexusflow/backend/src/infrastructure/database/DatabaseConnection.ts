import Database from 'better-sqlite3';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

/**
 * DatabaseConnection — singleton wrapper around better-sqlite3.
 * Handles schema migrations and provides a typed connection.
 */
export class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;
  public readonly db: Database.Database;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.configure();
    this.migrate();
    logger.info('Database initialised', { path: dbPath });
  }

  /** Returns (or creates) the singleton database connection */
  static getInstance(dbPath?: string): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection(dbPath ?? config.DB_PATH);
    }
    return DatabaseConnection.instance;
  }

  /** Apply SQLite performance PRAGMAs */
  private configure(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = -65536'); // 64 MB
  }

  /** Idempotent schema creation — safe to run on every startup */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        status       TEXT NOT NULL DEFAULT 'IDLE',
        tags         TEXT NOT NULL DEFAULT '[]',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        started_at   TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        pipeline_id  TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        priority     INTEGER NOT NULL DEFAULT 2,
        status       TEXT NOT NULL DEFAULT 'PENDING',
        payload      TEXT NOT NULL DEFAULT '{}',
        depends_on   TEXT NOT NULL DEFAULT '[]',
        retry_count  INTEGER NOT NULL DEFAULT 0,
        max_retries  INTEGER NOT NULL DEFAULT 3,
        result       TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        queued_at    TEXT,
        started_at   TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_pipeline_id ON tasks(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority    ON tasks(priority, queued_at);

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'viewer',
        created_at    TEXT NOT NULL
      );
    `);
  }

  /** Gracefully close the database */
  close(): void {
    this.db.close();
    DatabaseConnection.instance = null;
    logger.info('Database connection closed');
  }
}
