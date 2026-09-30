// ============================================================
// src/index.ts
// Application entry point — initializes all services
// ============================================================

import * as http from 'http';
import { getConfig } from './config';
import { getLogger, createLogger, setLogger } from './config/logger';
import { MemoryStore } from './storage/memory-store';
import { EventBus } from './core/event-bus';
import { Scheduler } from './core/scheduler';
import { createApp } from './api/app';
import { WSServer } from './api/websocket-server';
import { HandlerFunction } from './types';

// Built-in example handlers (real workloads would register their own)
const builtInHandlers: Record<string, HandlerFunction> = {
  'echo': async (ctx) => {
    return { success: true, output: { echoed: ctx.input } };
  },
  'sleep': async (ctx) => {
    const ms = (ctx.input['ms'] as number) ?? 100;
    await new Promise((r) => setTimeout(r, ms));
    return { success: true, output: { sleptMs: ms } };
  },
  'fail': async (_ctx) => {
    return { success: false, error: 'Intentional failure for testing' };
  },
  'fail-once': async (ctx) => {
    if (ctx.retryCount === 0) {
      return { success: false, error: 'First attempt fails' };
    }
    return { success: true, output: { retriedSuccessfully: true } };
  },
};

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger(config.logLevel);
  setLogger(logger);

  logger.info('TaskFlow Engine starting', { env: config.nodeEnv, port: config.port });

  // Storage
  const store = new MemoryStore(config.dataDir, config.dlqMaxSize);
  const loaded = await store.loadFromDisk();
  if (loaded) {
    logger.info('State restored from disk');
  }

  // Event bus
  const eventBus = EventBus.getInstance();

  // Scheduler
  const scheduler = new Scheduler({ config, storage: store, eventBus });

  // Register built-in handlers
  for (const [name, fn] of Object.entries(builtInHandlers)) {
    scheduler.registerHandler(name, fn);
  }

  scheduler.start();

  // HTTP app
  const app = createApp(scheduler, eventBus, config);
  const server = http.createServer(app);

  // WebSocket
  const wsServer = new WSServer(server, eventBus);

  // Start listening
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      logger.info(`Server listening on http://${config.host}:${config.port}`);
      logger.info(`WebSocket available at ws://${config.host}:${config.port}/ws`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    wsServer.close();
    await scheduler.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  getLogger().error('Fatal startup error', { error: String(err), stack: err.stack });
  process.exit(1);
});
