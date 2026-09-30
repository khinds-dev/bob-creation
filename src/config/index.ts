// ============================================================
// src/config/index.ts
// Configuration loader with environment variable validation
// ============================================================

import * as path from 'path';

export interface AppConfig {
  dataDir: string;
  port: number;
  host: string;
  logLevel: string;
  maxWorkers: number;
  maxQueueSize: number;
  defaultJobTimeoutMs: number;
  defaultMaxRetries: number;
  defaultRetryBackoffBaseMs: number;
  defaultRetryBackoffMaxMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  dlqMaxSize: number;
  persistenceFlushIntervalMs: number;
  nodeEnv: string;
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: "${val}"`);
  }
  return parsed;
}

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function validate(config: AppConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${config.port}`);
  }
  if (config.maxWorkers < 1 || config.maxWorkers > 1000) {
    throw new Error(`MAX_WORKERS must be between 1 and 1000, got: ${config.maxWorkers}`);
  }
  if (config.maxQueueSize < 1) {
    throw new Error(`MAX_QUEUE_SIZE must be positive, got: ${config.maxQueueSize}`);
  }
  if (config.defaultJobTimeoutMs < 100) {
    throw new Error(`DEFAULT_JOB_TIMEOUT_MS must be at least 100ms, got: ${config.defaultJobTimeoutMs}`);
  }
  if (config.defaultMaxRetries < 0) {
    throw new Error(`DEFAULT_MAX_RETRIES must be >= 0, got: ${config.defaultMaxRetries}`);
  }
  const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  if (!validLogLevels.includes(config.logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${validLogLevels.join(', ')}, got: "${config.logLevel}"`);
  }
}

export function loadConfig(): AppConfig {
  const config: AppConfig = {
    dataDir: path.resolve(getEnvString('DATA_DIR', './data')),
    port: getEnvInt('PORT', 3000),
    host: getEnvString('HOST', '0.0.0.0'),
    logLevel: getEnvString('LOG_LEVEL', 'info'),
    maxWorkers: getEnvInt('MAX_WORKERS', 10),
    maxQueueSize: getEnvInt('MAX_QUEUE_SIZE', 10000),
    defaultJobTimeoutMs: getEnvInt('DEFAULT_JOB_TIMEOUT_MS', 30000),
    defaultMaxRetries: getEnvInt('DEFAULT_MAX_RETRIES', 3),
    defaultRetryBackoffBaseMs: getEnvInt('DEFAULT_RETRY_BACKOFF_BASE_MS', 1000),
    defaultRetryBackoffMaxMs: getEnvInt('DEFAULT_RETRY_BACKOFF_MAX_MS', 30000),
    rateLimitWindowMs: getEnvInt('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMaxRequests: getEnvInt('RATE_LIMIT_MAX_REQUESTS', 100),
    dlqMaxSize: getEnvInt('DLQ_MAX_SIZE', 1000),
    persistenceFlushIntervalMs: getEnvInt('PERSISTENCE_FLUSH_INTERVAL_MS', 5000),
    nodeEnv: getEnvString('NODE_ENV', 'development'),
  };
  validate(config);
  return config;
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Reset config (for testing)
export function resetConfig(): void {
  _config = null;
}
