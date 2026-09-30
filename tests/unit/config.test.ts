// ============================================================
// tests/unit/config.test.ts
// Unit tests for configuration loading and validation
// ============================================================

import { loadConfig, resetConfig } from '../../src/config';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it('loads defaults when no env vars set', () => {
    delete process.env['PORT'];
    delete process.env['MAX_WORKERS'];
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
});
