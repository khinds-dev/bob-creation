import { config } from './config';

/** Log severity levels in ascending order */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

class Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVEL_RANK[level];
  }

  /**
   * Write a structured JSON log entry to stdout/stderr.
   * @param level - Severity level
   * @param message - Human-readable message
   * @param meta - Optional additional fields merged into the log entry
   * @param correlationId - Optional request correlation identifier
   */
  private write(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
    correlationId?: string
  ): void {
    if (LEVEL_RANK[level] < this.minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(correlationId ? { correlationId } : {}),
      ...(meta ?? {}),
    };

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  debug(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    this.write('debug', message, meta, correlationId);
  }

  info(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    this.write('info', message, meta, correlationId);
  }

  warn(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    this.write('warn', message, meta, correlationId);
  }

  error(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    this.write('error', message, meta, correlationId);
  }
}

export const logger = new Logger(config.LOG_LEVEL);
