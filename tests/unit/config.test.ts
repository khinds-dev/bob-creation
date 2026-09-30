// ============================================================
// tests/unit/config.test.ts
// Unit tests for configuration loading and validation
// ============================================================

import { loadConfig, resetConfig, getConfig } from '../../src/config';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Full clean-slate env for every test
    process.env = { ...originalEnv };
    // Remove all keys this module touches so defaults kick in cleanly
    delete process.env['PORT'];
    delete process.env['HOST'];
    delete process.env['LOG_LEVEL'];
    delete process.env['MAX_WORKERS'];
    delete process.env['MAX_QUEUE_SIZE'];
    delete process.env['DEFAULT_JOB_TIMEOUT_MS'];
    delete process.env['DEFAULT_MAX_RETRIES'];
    delete process.env['DEFAULT_RETRY_BACKOFF_BASE_MS'];
    delete process.env['DEFAULT_RETRY_BACKOFF_MAX_MS'];
    delete process.env['RATE_LIMIT_WINDOW_MS'];
    delete process.env['RATE_LIMIT_MAX_REQUESTS'];
    delete process.env['DLQ_MAX_SIZE'];
    delete process.env['PERSISTENCE_FLUSH_INTERVAL_MS'];
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it('loads defaults when no env vars set', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.maxWorkers).toBe(10);
    expect(config.logLevel).toBe('info');
  });

  it('reads PORT from env', () => {
    process.env['PORT'] = '8080';
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it('reads MAX_WORKERS from env', () => {
    process.env['MAX_WORKERS'] = '20';
    const config = loadConfig();
    expect(config.maxWorkers).toBe(20);
  });

  it('throws on invalid PORT', () => {
    process.env['PORT'] = '99999';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on non-integer PORT', () => {
    process.env['PORT'] = 'notanumber';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on invalid LOG_LEVEL', () => {
    process.env['LOG_LEVEL'] = 'verbosely';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on MAX_WORKERS < 1', () => {
    process.env['MAX_WORKERS'] = '0';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on negative DEFAULT_MAX_RETRIES', () => {
    process.env['DEFAULT_MAX_RETRIES'] = '-1';
    expect(() => loadConfig()).toThrow();
  });

  it('throws on DEFAULT_JOB_TIMEOUT_MS too small', () => {
    process.env['DEFAULT_JOB_TIMEOUT_MS'] = '50';
    expect(() => loadConfig()).toThrow();
  });

  it('getConfig returns singleton on repeated calls', () => {
    const c1 = getConfig();
    const c2 = getConfig();
    expect(c1).toBe(c2);
  });

  it('resetConfig clears singleton so next call reloads', () => {
    const c1 = getConfig();
    resetConfig();
    process.env['PORT'] = '4567';
    const c2 = getConfig();
    expect(c2).not.toBe(c1);
    expect(c2.port).toBe(4567);
  });

  it('loads all numeric defaults correctly', () => {
    const config = loadConfig();
    expect(config.maxQueueSize).toBe(10000);
    expect(config.defaultJobTimeoutMs).toBe(30000);
    expect(config.defaultMaxRetries).toBe(3);
    expect(config.defaultRetryBackoffBaseMs).toBe(1000);
    expect(config.defaultRetryBackoffMaxMs).toBe(30000);
    expect(config.rateLimitWindowMs).toBe(60000);
    expect(config.rateLimitMaxRequests).toBe(100);
    expect(config.dlqMaxSize).toBe(1000);
  });

  it('throws on MAX_WORKERS > 1000', () => {
    process.env['MAX_WORKERS'] = '1001';
    expect(() => loadConfig()).toThrow(/MAX_WORKERS/);
  });

  it('throws on MAX_QUEUE_SIZE < 1', () => {
    process.env['MAX_QUEUE_SIZE'] = '0';
    expect(() => loadConfig()).toThrow();
  });
});
