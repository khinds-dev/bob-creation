// ============================================================
// tests/unit/event-bus.test.ts
// Unit tests for the EventBus pub/sub implementation
// ============================================================

import { EventBus } from '../../src/core/event-bus';
import { EventType } from '../../src/types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    EventBus.resetInstance();
    bus = new EventBus(50); // small log for testing
  });

  afterEach(() => {
    EventBus.resetInstance();
  });

  describe('singleton', () => {
    it('getInstance returns the same instance on repeated calls', () => {
      EventBus.resetInstance();
      const a = EventBus.getInstance();
      const b = EventBus.getInstance();
      expect(a).toBe(b);
    });

    it('resetInstance creates a fresh instance', () => {
      const a = EventBus.getInstance();
      EventBus.resetInstance();
      const b = EventBus.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('publish', () => {
    it('returns the published event with correct fields', () => {
      const event = bus.publish(EventType.JOB_SUBMITTED, { foo: 'bar' }, {
        workflowExecutionId: 'wf-1',
        jobId: 'job-1',
        stepId: 'step-1',
      });
      expect(event.type).toBe(EventType.JOB_SUBMITTED);
      expect(event.payload).toEqual({ foo: 'bar' });
      expect(event.workflowExecutionId).toBe('wf-1');
      expect(event.jobId).toBe('job-1');
      expect(event.stepId).toBe('step-1');
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('event is added to the internal log', () => {
      bus.publish(EventType.METRIC, { value: 42 });
      const events = bus.getRecentEvents(10);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(EventType.METRIC);
    });

    it('log is capped at maxLogSize (oldest entries dropped)', () => {
      // Bus created with maxLogSize=50
      for (let i = 0; i < 60; i++) {
        bus.publish(EventType.LOG, { i });
      }
      const events = bus.getRecentEvents(1000);
      expect(events.length).toBe(50);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('calls handler when matching event is published', () => {
      const calls: unknown[] = [];
      bus.subscribe(EventType.JOB_STARTED, (ev) => calls.push(ev));
      bus.publish(EventType.JOB_STARTED, { jobId: 'j1' });
      expect(calls).toHaveLength(1);
    });

    it('does not call handler for a different event type', () => {
      const calls: unknown[] = [];
      bus.subscribe(EventType.JOB_STARTED, (ev) => calls.push(ev));
      bus.publish(EventType.JOB_COMPLETED, { jobId: 'j2' });
      expect(calls).toHaveLength(0);
    });

    it('wildcard subscriber receives all events', () => {
      const calls: string[] = [];
      bus.subscribe('*', (ev) => calls.push(ev.type));
      bus.publish(EventType.JOB_STARTED, {});
      bus.publish(EventType.JOB_COMPLETED, {});
      bus.publish(EventType.WORKFLOW_FAILED, {});
      expect(calls).toEqual([
        EventType.JOB_STARTED,
        EventType.JOB_COMPLETED,
        EventType.WORKFLOW_FAILED,
      ]);
    });

    it('unsubscribe function removes the handler', () => {
      const calls: unknown[] = [];
      const unsub = bus.subscribe(EventType.WORKFLOW_SUBMITTED, (ev) => calls.push(ev));
      bus.publish(EventType.WORKFLOW_SUBMITTED, {});
      expect(calls).toHaveLength(1);

      unsub();
      bus.publish(EventType.WORKFLOW_SUBMITTED, {});
      expect(calls).toHaveLength(1); // no new call after unsubscribe
    });

    it('multiple subscribers all receive the event', () => {
      const calls1: unknown[] = [];
      const calls2: unknown[] = [];
      bus.subscribe(EventType.JOB_FAILED, (ev) => calls1.push(ev));
      bus.subscribe(EventType.JOB_FAILED, (ev) => calls2.push(ev));
      bus.publish(EventType.JOB_FAILED, { error: 'oops' });
      expect(calls1).toHaveLength(1);
      expect(calls2).toHaveLength(1);
    });
  });

  describe('getRecentEvents', () => {
    it('returns empty array when no events', () => {
      expect(bus.getRecentEvents()).toEqual([]);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        bus.publish(EventType.LOG, { i });
      }
      expect(bus.getRecentEvents(3)).toHaveLength(3);
    });

    it('returns the most recent events (end of log)', () => {
      for (let i = 0; i < 5; i++) {
        bus.publish(EventType.LOG, { i });
      }
      const all = bus.getRecentEvents(10);
      const limited = bus.getRecentEvents(2);
      expect(limited[0]).toBe(all[all.length - 2]);
      expect(limited[1]).toBe(all[all.length - 1]);
    });

    it('filters by event type when specified', () => {
      bus.publish(EventType.JOB_STARTED, {});
      bus.publish(EventType.JOB_COMPLETED, {});
      bus.publish(EventType.JOB_STARTED, {});

      const started = bus.getRecentEvents(100, EventType.JOB_STARTED);
      expect(started).toHaveLength(2);
      expect(started.every((e) => e.type === EventType.JOB_STARTED)).toBe(true);
    });
  });

  describe('getEventsByWorkflow', () => {
    it('returns only events for the given workflow', () => {
      bus.publish(EventType.WORKFLOW_STARTED, {}, { workflowExecutionId: 'wf-a' });
      bus.publish(EventType.WORKFLOW_STARTED, {}, { workflowExecutionId: 'wf-b' });
      bus.publish(EventType.JOB_COMPLETED, {}, { workflowExecutionId: 'wf-a' });

      const events = bus.getEventsByWorkflow('wf-a');
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.workflowExecutionId === 'wf-a')).toBe(true);
    });

    it('returns empty array for unknown workflow', () => {
      bus.publish(EventType.WORKFLOW_STARTED, {}, { workflowExecutionId: 'wf-other' });
      expect(bus.getEventsByWorkflow('wf-ghost')).toEqual([]);
    });
  });

  describe('clearLog', () => {
    it('empties the event log', () => {
      bus.publish(EventType.LOG, { msg: 'hello' });
      bus.publish(EventType.LOG, { msg: 'world' });
      expect(bus.getRecentEvents().length).toBe(2);
      bus.clearLog();
      expect(bus.getRecentEvents().length).toBe(0);
    });
  });
});
