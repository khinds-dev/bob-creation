import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';

/** Extend Express Request with correlationId */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

/** Attach a unique correlation ID to every request */
export function correlationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? uuidv4();
  next();
}

/** Structured request logging */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    }, req.correlationId);
  });
  next();
}

/** Global error handler — must be registered last */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof AppError && err.isOperational) {
    logger.warn('Operational error', {
      name: err.name,
      message: err.message,
      statusCode: err.statusCode,
    }, req.correlationId);

    res.status(err.statusCode).json({
      error: {
        type: err.name,
        message: err.message,
        ...(('fields' in err && err.fields) ? { fields: err.fields } : {}),
        ...('retryAfterMs' in err ? { retryAfterMs: err.retryAfterMs } : {}),
      },
    });
    return;
  }

  // Unexpected errors
  logger.error('Unexpected error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }, req.correlationId);

  res.status(500).json({
    error: {
      type: 'InternalServerError',
      message: 'An unexpected error occurred',
    },
  });
}
