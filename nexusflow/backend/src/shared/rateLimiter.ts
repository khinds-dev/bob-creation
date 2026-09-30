import { config } from './config';
import { RateLimitError } from './errors';

/**
 * Sliding Window Rate Limiter
 *
 * Implements the sliding window algorithm:
 * - Maintains a timestamp log of requests per client key.
 * - On each request, evicts timestamps older than `windowMs`.
 * - If the remaining count ≥ maxRequests, rejects with a RateLimitError.
 *
 * Time complexity: O(n) per check where n = requests in window (bounded by maxRequests).
 * Space complexity: O(clients × maxRequests).
 */
export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  /** Map from client key to sorted array of request timestamps (ms) */
  private readonly store: Map<string, number[]> = new Map();

  constructor(windowMs?: number, maxRequests?: number) {
    this.windowMs = windowMs ?? config.RATE_LIMIT_WINDOW_MS;
    this.maxRequests = maxRequests ?? config.RATE_LIMIT_MAX_REQUESTS;
  }

  /**
   * Check and record a request for the given key.
   * @throws {RateLimitError} when the limit is exceeded
   */
  check(key: string): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.store.get(key) ?? [];

    // Evict timestamps outside the current window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      // Oldest timestamp tells us when the window will slide enough
      const oldest = timestamps[0];
      const retryAfterMs = oldest + this.windowMs - now;
      throw new RateLimitError(retryAfterMs);
    }

    timestamps.push(now);
    this.store.set(key, timestamps);
  }

  /** Return the number of requests made by key within the current window */
  getCount(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.store.get(key) ?? [];
    return timestamps.filter((t) => t > windowStart).length;
  }

  /** Evict all state for a given key (e.g., after authentication) */
  reset(key: string): void {
    this.store.delete(key);
  }

  /** Periodic cleanup of fully-expired client entries to prevent memory growth */
  purgeExpired(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.store.entries()) {
      const active = timestamps.filter((t) => t > windowStart);
      if (active.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, active);
      }
    }
  }
}
