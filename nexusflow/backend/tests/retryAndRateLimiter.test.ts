import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryPolicy, sleep } from '../src/infrastructure/RetryPolicy';

describe('RetryPolicy', () => {
  let policy: RetryPolicy;

  beforeEach(() => {
    policy = new RetryPolicy(3, 100, 10_000);
  });

  it('shouldRetry returns true when retries remain', () => {
    expect(policy.shouldRetry(0)).toBe(true);
    expect(policy.shouldRetry(1)).toBe(true);
    expect(policy.shouldRetry(2)).toBe(true);
  });

  it('shouldRetry returns false when max retries exhausted', () => {
    expect(policy.shouldRetry(3)).toBe(false);
    expect(policy.shouldRetry(10)).toBe(false);
  });

  it('getDelayMs returns 0 for first attempt (base * 2^0 = base, then random up to base)', () => {
    // With full jitter: delay is in [0, min(base * 2^attempt, max)]
    // attempt 0 → range [0, 100), attempt 1 → [0, 200), attempt 2 → [0, 400)
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = policy.getDelayMs(attempt);
      const cap = Math.min(100 * Math.pow(2, attempt), 10_000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(cap);
    }
  });

  it('getDelayMs caps at maxMs', () => {
    const tightPolicy = new RetryPolicy(10, 1000, 500);
    // For large attempt numbers: base * 2^attempt would be huge but should cap at 500
    for (let i = 5; i < 10; i++) {
      expect(tightPolicy.getDelayMs(i)).toBeLessThan(500);
    }
  });

  it('maxRetries getter returns configured value', () => {
    expect(policy.maxRetries).toBe(3);
  });
});

describe('sleep', () => {
  it('resolves after the specified duration', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // allow some timer slack
  });

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when signal is aborted during sleep', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(sleep(5000, controller.signal)).rejects.toThrow();
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('allows requests up to the limit', async () => {
    const { SlidingWindowRateLimiter } = await import('../src/shared/rateLimiter');
    const limiter = new SlidingWindowRateLimiter(1000, 5);

    for (let i = 0; i < 5; i++) {
      expect(() => limiter.check('test-key')).not.toThrow();
    }
  });

  it('throws RateLimitError on exceeding the limit', async () => {
    const { SlidingWindowRateLimiter } = await import('../src/shared/rateLimiter');
    const { RateLimitError } = await import('../src/shared/errors');
    const limiter = new SlidingWindowRateLimiter(1000, 3);

    limiter.check('key');
    limiter.check('key');
    limiter.check('key');

    expect(() => limiter.check('key')).toThrow(RateLimitError);
  });

  it('tracks counts independently per key', async () => {
    const { SlidingWindowRateLimiter } = await import('../src/shared/rateLimiter');
    const limiter = new SlidingWindowRateLimiter(1000, 2);

    limiter.check('keyA');
    limiter.check('keyA');
    expect(() => limiter.check('keyA')).toThrow();

    // keyB is unaffected
    expect(() => limiter.check('keyB')).not.toThrow();
    expect(() => limiter.check('keyB')).not.toThrow();
  });

  it('getCount returns accurate count within window', async () => {
    const { SlidingWindowRateLimiter } = await import('../src/shared/rateLimiter');
    const limiter = new SlidingWindowRateLimiter(1000, 10);

    limiter.check('k');
    limiter.check('k');
    limiter.check('k');

    expect(limiter.getCount('k')).toBe(3);
  });

  it('reset clears the key state', async () => {
    const { SlidingWindowRateLimiter } = await import('../src/shared/rateLimiter');
    const { RateLimitError } = await import('../src/shared/errors');
    const limiter = new SlidingWindowRateLimiter(1000, 2);

    limiter.check('r');
    limiter.check('r');
    expect(() => limiter.check('r')).toThrow(RateLimitError);

    limiter.reset('r');
    expect(() => limiter.check('r')).not.toThrow();
  });
});
