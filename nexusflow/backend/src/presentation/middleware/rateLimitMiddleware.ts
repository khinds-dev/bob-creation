import { Request, Response, NextFunction } from 'express';
import { SlidingWindowRateLimiter } from '../../shared/rateLimiter';
import { RateLimitError } from '../../shared/errors';

const limiter = new SlidingWindowRateLimiter();

// Purge expired entries every 5 minutes
setInterval(() => limiter.purgeExpired(), 5 * 60_000);

/**
 * Rate limiting middleware using the sliding window algorithm.
 * Key is derived from client IP address.
 */
export function rateLimitMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  try {
    limiter.check(ip);
    next();
  } catch (err) {
    if (err instanceof RateLimitError) {
      next(err);
    } else {
      next(err);
    }
  }
}
