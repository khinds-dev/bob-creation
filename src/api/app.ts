// ============================================================
// src/api/app.ts
// Express application factory
// ============================================================

import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Scheduler } from '../core/scheduler';
import { EventBus } from '../core/event-bus';
import { createRouter } from './router';
import { errorHandler, notFoundHandler, requestLogger } from './middleware';
import { AppConfig } from '../config';

export function createApp(
  scheduler: Scheduler,
  eventBus: EventBus,
  config: AppConfig
): Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(cors());

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging
  app.use(requestLogger);

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
    skip: () => config.nodeEnv === 'test',
  });
  app.use('/api', limiter);

  // Routes
  app.use('/api', createRouter(scheduler, eventBus));

  // 404 & error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
