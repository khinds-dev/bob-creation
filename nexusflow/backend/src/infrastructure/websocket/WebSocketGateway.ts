import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../../shared/logger';
import { Task } from '../../domain/Task';
import { Pipeline } from '../../domain/Pipeline';
import { WorkerPoolStats } from '../../domain/Worker';

/** All event types broadcast over WebSocket */
export type WSEventType =
  | 'task:created'
  | 'task:queued'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled'
  | 'task:retrying'
  | 'pipeline:created'
  | 'pipeline:started'
  | 'pipeline:completed'
  | 'pipeline:failed'
  | 'pipeline:cancelled'
  | 'worker:stats'
  | 'queue:stats';

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
  timestamp: string;
}

export interface QueueStats {
  size: number;
  byPriority: Record<string, number>;
}

/**
 * WebSocketGateway — manages the WS server and provides a broadcast API.
 * All connected clients receive every domain event (pub/sub fanout).
 */
export class WebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly clients: Set<WebSocket> = new Set();
  /** Heartbeat interval handle */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });
    this.wss.on('error', (err: Error) => {
      logger.error('WebSocket server error', { error: err.message });
    });
    this.startHeartbeat();
    logger.info('WebSocket gateway started', { port });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = req.socket.remoteAddress ?? 'unknown';
    logger.debug('WebSocket client connected', { ip, total: this.clients.size + 1 });
    this.clients.add(ws);

    // Send a welcome ping
    this.send(ws, { type: 'queue:stats', payload: { size: 0, byPriority: {} }, timestamp: new Date().toISOString() });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.debug('WebSocket client disconnected', { total: this.clients.size });
    });

    ws.on('error', (err: Error) => {
      logger.warn('WebSocket client error', { error: err.message });
      this.clients.delete(ws);
    });

    ws.on('message', (data: Buffer) => {
      // Clients may send ping frames; log but don't process
      logger.debug('WebSocket message received', { data: data.toString().slice(0, 100) });
    });
  }

  private send(ws: WebSocket, event: WSEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast<T>(type: WSEventType, payload: T): void {
    const event: WSEvent<T> = { type, payload, timestamp: new Date().toISOString() };
    const data = JSON.stringify(event);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        sent++;
      }
    }
    logger.debug('WebSocket broadcast', { type, clients: sent });
  }

  broadcastTaskEvent(type: WSEventType, task: Task): void {
    this.broadcast(type, task);
  }

  broadcastPipelineEvent(type: WSEventType, pipeline: Pipeline): void {
    this.broadcast(type, pipeline);
  }

  broadcastWorkerStats(stats: WorkerPoolStats): void {
    this.broadcast('worker:stats', stats);
  }

  broadcastQueueStats(stats: QueueStats): void {
    this.broadcast('queue:stats', stats);
  }

  get connectedClients(): number {
    return this.clients.size;
  }

  /** Periodic heartbeat to prune stale connections */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) {
          this.clients.delete(ws);
        }
      }
    }, 30_000);
  }

  async close(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    return new Promise((resolve) => {
      this.wss.close(() => {
        logger.info('WebSocket gateway closed');
        resolve();
      });
    });
  }
}
