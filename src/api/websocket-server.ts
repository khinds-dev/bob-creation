// ============================================================
// src/api/websocket-server.ts
// WebSocket server for streaming live execution events
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import { EventBus } from '../core/event-bus';
import { EngineEvent, EventType } from '../types';
import { getLogger } from '../config/logger';

interface WSClient {
  ws: WebSocket;
  subscriptions: Set<string>; // 'all' | workflowId | EventType
  isAlive: boolean;
}

export class WSServer {
  private readonly wss: WebSocketServer;
  private readonly clients: Map<string, WSClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;

  constructor(server: Server, eventBus: EventBus) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    // Subscribe to all events and fan out to WS clients
    this.unsubscribe = eventBus.subscribe('*', (event) => this.broadcast(event));

    // Heartbeat to detect dead clients
    this.heartbeatInterval = setInterval(() => this.pingClients(), 30000);

    getLogger().info('WSServer: started');
  }

  private onConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client: WSClient = {
      ws,
      subscriptions: new Set(['all']),
      isAlive: true,
    };
    this.clients.set(clientId, client);
    getLogger().debug('WSServer: client connected', { clientId, total: this.clients.size });

    ws.on('pong', () => {
      const c = this.clients.get(clientId);
      if (c) c.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleClientMessage(clientId, msg);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      getLogger().debug('WSServer: client disconnected', { clientId, total: this.clients.size });
    });

    ws.on('error', (err) => {
      getLogger().error('WSServer: client error', { clientId, error: String(err) });
      this.clients.delete(clientId);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      message: 'Connected to TaskFlow Engine event stream',
    }));
  }

  private handleClientMessage(clientId: string, msg: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (msg['action'] === 'subscribe') {
      const topic = msg['topic'] as string;
      if (topic) {
        client.subscriptions.add(topic);
        client.ws.send(JSON.stringify({ type: 'subscribed', topic }));
      }
    } else if (msg['action'] === 'unsubscribe') {
      const topic = msg['topic'] as string;
      if (topic) {
        client.subscriptions.delete(topic);
        client.ws.send(JSON.stringify({ type: 'unsubscribed', topic }));
      }
    } else if (msg['action'] === 'ping') {
      client.ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  private broadcast(event: EngineEvent): void {
    const payload = JSON.stringify(event);
    for (const [, client] of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      // Check if client is interested in this event
      const interested =
        client.subscriptions.has('all') ||
        client.subscriptions.has(event.type) ||
        (event.workflowExecutionId && client.subscriptions.has(event.workflowExecutionId));

      if (interested) {
        try {
          client.ws.send(payload);
        } catch (err) {
          getLogger().error('WSServer: send error', { error: String(err) });
        }
      }
    }
  }

  private pingClients(): void {
    for (const [clientId, client] of this.clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        this.clients.delete(clientId);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }

  getConnectedCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.unsubscribe();
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.wss.close();
    getLogger().info('WSServer: stopped');
  }
}
