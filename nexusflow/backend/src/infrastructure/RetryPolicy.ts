/**
 * RetryPolicy — implements exponential backoff with full jitter.
 *
 * ## Formula
 *   base_delay = baseMs * (2 ^ attempt)
 *   capped     = min(base_delay, maxMs)
 *   jitter     = random(0, capped)      ← full jitter strategy
 *
 * Full jitter prevents thundering-herd when many tasks retry simultaneously.
 *
 * Reference: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export class RetryPolicy {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly maxAttempts: number;

  constructor(
    maxAttempts = 3,
    baseMs = 1000,
    maxMs = 30_000
  ) {
    this.maxAttempts = maxAttempts;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
  }

  /**
   * Returns true when another retry should be attempted.
   * @param currentRetryCount - number of retries already performed
   */
  shouldRetry(currentRetryCount: number): boolean {
    return currentRetryCount < this.maxAttempts;
  }

  /**
   * Compute the delay (ms) before the next retry attempt.
   * @param attempt - zero-based attempt number (0 = first retry)
   */
  getDelayMs(attempt: number): number {
    const exponential = this.baseMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.maxMs);
    // Full jitter: random value in [0, capped)
    return Math.floor(Math.random() * capped);
  }

  get maxRetries(): number {
    return this.maxAttempts;
  }
}

/**
 * Convenience function: sleep for `ms` milliseconds.
 * Respects the AbortSignal if provided — rejects early on abort.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
