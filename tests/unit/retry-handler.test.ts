// ============================================================
// tests/unit/retry-handler.test.ts
// Unit tests for retry policy and backoff computation
// ============================================================

import {
  computeBackoffDelayMs,
  canRetry,
  getDefaultRetryPolicy,
  mergeRetryPolicy,
} from '../../src/core/retry-handler';
import { RetryPolicy } from '../../src/types';

const basePolicy: RetryPolicy = {
  maxRetries: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  backoffMultiplier: 2,
};

describe('RetryHandler', () => {
  describe('canRetry', () => {
    it('returns true when retryCount < maxRetries', () => {
      expect(canRetry(0, basePolicy)).toBe(true);
      expect(canRetry(1, basePolicy)).toBe(true);
      expect(canRetry(2, basePolicy)).toBe(true);
    });

    it('returns false when retryCount === maxRetries', () => {
      expect(canRetry(3, basePolicy)).toBe(false);
    });

    it('returns false when retryCount > maxRetries', () => {
      expect(canRetry(5, basePolicy)).toBe(false);
    });

    it('returns false when maxRetries is 0', () => {
      expect(canRetry(0, { ...basePolicy, maxRetries: 0 })).toBe(false);
    });
  });

  describe('computeBackoffDelayMs', () => {
    it('returns value >= 0', () => {
      const delay = computeBackoffDelayMs(0, basePolicy, false);
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('increases with retry count (no jitter)', () => {
      const delay0 = computeBackoffDelayMs(0, basePolicy, false);
      const delay1 = computeBackoffDelayMs(1, basePolicy, false);
      const delay2 = computeBackoffDelayMs(2, basePolicy, false);
      expect(delay1).toBeGreaterThanOrEqual(delay0);
      expect(delay2).toBeGreaterThanOrEqual(delay1);
    });

    it('never exceeds backoffMaxMs', () => {
      for (let i = 0; i < 20; i++) {
        const delay = computeBackoffDelayMs(i, basePolicy, false);
        expect(delay).toBeLessThanOrEqual(basePolicy.backoffMaxMs);
      }
    });

    it('caps at backoffMaxMs for large retry counts', () => {
      const delay = computeBackoffDelayMs(100, basePolicy, false);
      expect(delay).toBe(basePolicy.backoffMaxMs);
    });

    it('with jitter returns value within [0, capped]', () => {
      for (let i = 0; i < 50; i++) {
        const delay = computeBackoffDelayMs(0, basePolicy, true);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(basePolicy.backoffBaseMs);
      }
    });

    it('computes correct exponential backoff', () => {
      // base=1000, multiplier=2 => retry 0: 1000, retry 1: 2000, retry 2: 4000
      expect(computeBackoffDelayMs(0, basePolicy, false)).toBe(1000);
      expect(computeBackoffDelayMs(1, basePolicy, false)).toBe(2000);
      expect(computeBackoffDelayMs(2, basePolicy, false)).toBe(4000);
    });
  });

  describe('getDefaultRetryPolicy', () => {
    it('returns sensible defaults', () => {
      const policy = getDefaultRetryPolicy();
      expect(policy.maxRetries).toBe(3);
      expect(policy.backoffBaseMs).toBe(1000);
      expect(policy.backoffMaxMs).toBe(30000);
      expect(policy.backoffMultiplier).toBe(2);
    });

    it('applies overrides', () => {
      const policy = getDefaultRetryPolicy({ maxRetries: 5, backoffBaseMs: 500 });
      expect(policy.maxRetries).toBe(5);
      expect(policy.backoffBaseMs).toBe(500);
      expect(policy.backoffMaxMs).toBe(30000); // default
    });
  });

  describe('mergeRetryPolicy', () => {
    it('keeps base values when no overrides', () => {
      const merged = mergeRetryPolicy(basePolicy, {});
      expect(merged).toEqual(basePolicy);
    });

    it('applies all overrides', () => {
      const merged = mergeRetryPolicy(basePolicy, {
        maxRetries: 10,
        backoffBaseMs: 500,
        backoffMaxMs: 60000,
        backoffMultiplier: 3,
      });
      expect(merged.maxRetries).toBe(10);
      expect(merged.backoffBaseMs).toBe(500);
      expect(merged.backoffMaxMs).toBe(60000);
      expect(merged.backoffMultiplier).toBe(3);
    });

    it('applies partial overrides', () => {
      const merged = mergeRetryPolicy(basePolicy, { maxRetries: 0 });
      expect(merged.maxRetries).toBe(0);
      expect(merged.backoffBaseMs).toBe(basePolicy.backoffBaseMs);
    });
  });
});
