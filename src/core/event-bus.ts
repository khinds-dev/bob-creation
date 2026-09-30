// ============================================================
// src/core/event-bus.ts
// Internal pub/sub event bus with typed events
// ============================================================

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { EngineEvent, EventType } from '../types';
import { getLogger } from '../config/logger';

export type EventHandler = (event: EngineEvent) => void;

export class EventBus extends EventEmitter {
  private static instance: EventBus | null = null;
  private readonly eventLog: EngineEvent[] = [];
  private readonly maxLogSize: number;

  constructor(maxLogSize: number = 10000) {
    super();
    this.setMaxListeners(200);
    this.maxLogSize = maxLogSize;
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  static resetInstance(): void {
    if (EventBus.instance) {
      EventBus.instance.removeAllListeners();
    }
    EventBus.instance = null;
  }

  publish(
    type: EventType,
    payload: Record<string, unknown>,
    opts: {
      workflowExecutionId?: string;
      jobId?: string;
      stepId?: string;
    } = {}
  ): EngineEvent {
    const event: EngineEvent = {
      id: uuidv4(),
      type,
      timestamp: new Date(),
      payload,
      workflowExecutionId: opts.workflowExecutionId,
      jobId: opts.jobId,
      stepId: opts.stepId,
    };

    // Store in log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    // Emit on specific type channel
    this.emit(type, event);
    // Emit on wildcard channel for catch-all subscribers
    this.emit('*', event);

    getLogger().debug('EventBus.publish', {
      eventId: event.id,
      type,
      workflowExecutionId: opts.workflowExecutionId,
    });

    return event;
  }

  subscribe(type: EventType | '*', handler: EventHandler): () => void {
    this.on(type, handler);
    return () => this.off(type, handler);
  }

  getRecentEvents(limit: number = 100, type?: EventType): EngineEvent[] {
    let events = this.eventLog;
    if (type) {
      events = events.filter((e) => e.type === type);
    }
    return events.slice(-limit);
  }

  getEventsByWorkflow(workflowExecutionId: string): EngineEvent[] {
    return this.eventLog.filter((e) => e.workflowExecutionId === workflowExecutionId);
  }

  clearLog(): void {
    this.eventLog.length = 0;
  }
}
