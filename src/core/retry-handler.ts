// ============================================================
// src/core/retry-handler.ts
// Exponential backoff retry policy computation
// ============================================================

import { RetryPolicy } from '../types';

export class RetryExhaustedError extends Error {
  constructor(jobId: string, retryCount: number) {
    super(`Job ${jobId} exhausted all ${retryCount} retries`);
    this.name = 'RetryExhaustedError';
  }
}

export function computeBackoffDelayMs(
  retryCount: number,
  policy: RetryPolicy,
  jitter: boolean = true
): number {
  // Exponential backoff: base * multiplier^retryCount
  const exponential = policy.backoffBaseMs * Math.pow(policy.backoffMultiplier, retryCount);
  const capped = Math.min(exponential, policy.backoffMaxMs);

  if (jitter) {
    // Full jitter: random value in [0, capped]
    return Math.floor(Math.random() * capped);
  }
  return Math.floor(capped);
}

export function canRetry(retryCount: number, policy: RetryPolicy): boolean {
  return retryCount < policy.maxRetries;
}

export function getDefaultRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxRetries: overrides.maxRetries ?? 3,
    backoffBaseMs: overrides.backoffBaseMs ?? 1000,
    backoffMaxMs: overrides.backoffMaxMs ?? 30000,
    backoffMultiplier: overrides.backoffMultiplier ?? 2,
  };
}

export function mergeRetryPolicy(
  base: RetryPolicy,
  overrides: Partial<RetryPolicy>
): RetryPolicy {
  return {
    maxRetries: overrides.maxRetries ?? base.maxRetries,
    backoffBaseMs: overrides.backoffBaseMs ?? base.backoffBaseMs,
    backoffMaxMs: overrides.backoffMaxMs ?? base.backoffMaxMs,
    backoffMultiplier: overrides.backoffMultiplier ?? base.backoffMultiplier,
  };
}
