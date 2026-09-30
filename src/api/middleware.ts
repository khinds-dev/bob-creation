// ============================================================
// src/api/middleware.ts
// Validation, error handling, and rate limiting middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { getLogger } from '../config/logger';

// ── Error Types ───────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Validation Schemas ────────────────────────────────────────

const retryPolicySchema = Joi.object({
  maxRetries: Joi.number().integer().min(0).max(100),
  backoffBaseMs: Joi.number().integer().min(0),
  backoffMaxMs: Joi.number().integer().min(0),
  backoffMultiplier: Joi.number().min(1),
});

const stepSchema = Joi.object({
  id: Joi.string().trim().min(1).max(128).required(),
  name: Joi.string().trim().min(1).max(256).required(),
  handler: Joi.string().trim().min(1).max(128).required(),
  input: Joi.object().default({}),
  dependsOn: Joi.array().items(Joi.string()).default([]),
  retryPolicy: retryPolicySchema,
  timeoutMs: Joi.number().integer().min(100),
  metadata: Joi.object(),
});

export const dagSchema = Joi.object({
  id: Joi.string().trim().min(1).max(128).required(),
  name: Joi.string().trim().min(1).max(256).required(),
  description: Joi.string().max(1024),
  steps: Joi.array().items(stepSchema).min(1).required(),
  defaultRetryPolicy: retryPolicySchema,
  defaultTimeoutMs: Joi.number().integer().min(100),
  metadata: Joi.object(),
});

export const submitWorkflowSchema = Joi.object({
  dagId: Joi.string().trim().min(1).required(),
  input: Joi.object().default({}),
  priority: Joi.number().integer().min(1).max(100).default(5),
  metadata: Joi.object(),
});

export const queryParamsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(200).default(20),
  state: Joi.string().valid('PENDING', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED'),
  dagId: Joi.string(),
});

// ── Validation Middleware ─────────────────────────────────────

export function validateBody(schema: Joi.Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => d.message);
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }
    req.body = value;
    next();
  };
}

export function validateQuery(schema: Joi.Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, { abortEarly: false, allowUnknown: false });
    if (error) {
      const details = error.details.map((d) => d.message);
      res.status(400).json({ error: 'Invalid query parameters', details });
      return;
    }
    req.query = value;
    next();
  };
}

// ── Error Handler ─────────────────────────────────────────────

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const log = getLogger();

  if (err instanceof ApiError) {
    log.warn('ApiError', { statusCode: err.statusCode, message: err.message, path: req.path });
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  log.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
}

// ── Not Found ─────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

// ── Request Logger ────────────────────────────────────────────

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    getLogger().http(`${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
}
