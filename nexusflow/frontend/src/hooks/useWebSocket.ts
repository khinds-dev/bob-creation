import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSEvent, WSEventType } from '../types';

const WS_URL = `ws://localhost:3002`;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const MAX_FEED_LENGTH = 100;

export interface RealtimeFeedEntry {
  id: string;
  event: WSEvent;
  receivedAt: string;
}

type EventHandler<T = unknown> = (payload: T) => void;

/**
 * useWebSocket — manages a persistent WebSocket connection with
 * exponential backoff reconnection, typed event dispatch, and a
 * scrollable real-time event feed.
 */
export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const handlers = useRef<Map<WSEventType, Set<EventHandler>>>(new Map());
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<RealtimeFeedEntry[]>([]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      if (!isMounted.current) return;
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE_MS;
    };

    socket.onmessage = (ev: MessageEvent<string>) => {
      if (!isMounted.current) return;
      try {
        const event = JSON.parse(ev.data) as WSEvent;

        // Add to feed
        setFeed((prev) => {
          const entry: RealtimeFeedEntry = {
            id: `${Date.now()}-${Math.random()}`,
            event,
            receivedAt: new Date().toISOString(),
          };
          const next = [entry, ...prev];
          return next.length > MAX_FEED_LENGTH ? next.slice(0, MAX_FEED_LENGTH) : next;
        });

        // Dispatch to type-specific handlers
        const handlerSet = handlers.current.get(event.type);
        if (handlerSet) {
          for (const handler of handlerSet) handler(event.payload);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    socket.onclose = () => {
      if (!isMounted.current) return;
      setConnected(false);
      ws.current = null;
      // Exponential backoff reconnect
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_MS);
        connect();
      }, reconnectDelay.current);
    };

    socket.onerror = () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  /** Register a handler for a specific event type. Returns an unsubscribe function. */
  const on = useCallback(<T = unknown>(type: WSEventType, handler: EventHandler<T>): (() => void) => {
    const set = handlers.current.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    handlers.current.set(type, set);
    return () => {
      set.delete(handler as EventHandler);
    };
  }, []);

  return { connected, feed, on };
}
