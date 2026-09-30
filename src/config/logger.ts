// ============================================================
// src/config/logger.ts
// Winston logger setup
// ============================================================

import * as winston from 'winston';

let _logger: winston.Logger | null = null;

export function createLogger(level: string = 'info'): winston.Logger {
  const fmt = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  );

  return winston.createLogger({
    level,
    format: fmt,
    transports: [
      new winston.transports.Console({
        silent: process.env['NODE_ENV'] === 'test',
      }),
    ],
  });
}

export function getLogger(): winston.Logger {
  if (!_logger) {
    const level = process.env['LOG_LEVEL'] ?? 'info';
    _logger = createLogger(level);
  }
  return _logger;
}

export function setLogger(logger: winston.Logger): void {
  _logger = logger;
}

export function resetLogger(): void {
  _logger = null;
}
