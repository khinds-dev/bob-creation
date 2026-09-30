// ============================================================
// tests/unit/state-machine.test.ts
// Unit tests for job state machine transitions
// ============================================================

import {
  StateMachine,
  isValidTransition,
  isTerminalState,
  isActiveState,
  assertValidTransition,
  StateTransitionError,
} from '../../src/core/state-machine';
import { JobState } from '../../src/types';

describe('StateMachine', () => {
  describe('isValidTransition', () => {
    // Valid transitions
    it('allows PENDING -> RUNNING', () => expect(isValidTransition(JobState.PENDING, JobState.RUNNING)).toBe(true));
    it('allows PENDING -> CANCELLED', () => expect(isValidTransition(JobState.PENDING, JobState.CANCELLED)).toBe(true));
    it('allows RUNNING -> COMPLETED', () => expect(isValidTransition(JobState.RUNNING, JobState.COMPLETED)).toBe(true));
    it('allows RUNNING -> FAILED', () => expect(isValidTransition(JobState.RUNNING, JobState.FAILED)).toBe(true));
    it('allows RUNNING -> RETRYING', () => expect(isValidTransition(JobState.RUNNING, JobState.RETRYING)).toBe(true));
    it('allows RUNNING -> CANCELLED', () => expect(isValidTransition(JobState.RUNNING, JobState.CANCELLED)).toBe(true));
    it('allows RETRYING -> RUNNING', () => expect(isValidTransition(JobState.RETRYING, JobState.RUNNING)).toBe(true));
    it('allows RETRYING -> FAILED', () => expect(isValidTransition(JobState.RETRYING, JobState.FAILED)).toBe(true));
    it('allows RETRYING -> CANCELLED', () => expect(isValidTransition(JobState.RETRYING, JobState.CANCELLED)).toBe(true));

    // Invalid transitions
    it('denies COMPLETED -> RUNNING', () => expect(isValidTransition(JobState.COMPLETED, JobState.RUNNING)).toBe(false));
    it('denies FAILED -> RUNNING', () => expect(isValidTransition(JobState.FAILED, JobState.RUNNING)).toBe(false));
    it('denies CANCELLED -> RUNNING', () => expect(isValidTransition(JobState.CANCELLED, JobState.RUNNING)).toBe(false));
    it('denies PENDING -> COMPLETED', () => expect(isValidTransition(JobState.PENDING, JobState.COMPLETED)).toBe(false));
    it('denies COMPLETED -> FAILED', () => expect(isValidTransition(JobState.COMPLETED, JobState.FAILED)).toBe(false));
    it('denies RUNNING -> PENDING', () => expect(isValidTransition(JobState.RUNNING, JobState.PENDING)).toBe(false));
  });

  describe('isTerminalState', () => {
    it('identifies COMPLETED as terminal', () => expect(isTerminalState(JobState.COMPLETED)).toBe(true));
    it('identifies FAILED as terminal', () => expect(isTerminalState(JobState.FAILED)).toBe(true));
    it('identifies CANCELLED as terminal', () => expect(isTerminalState(JobState.CANCELLED)).toBe(true));
    it('identifies PENDING as non-terminal', () => expect(isTerminalState(JobState.PENDING)).toBe(false));
    it('identifies RUNNING as non-terminal', () => expect(isTerminalState(JobState.RUNNING)).toBe(false));
    it('identifies RETRYING as non-terminal', () => expect(isTerminalState(JobState.RETRYING)).toBe(false));
  });

  describe('isActiveState', () => {
    it('identifies RUNNING as active', () => expect(isActiveState(JobState.RUNNING)).toBe(true));
    it('identifies RETRYING as active', () => expect(isActiveState(JobState.RETRYING)).toBe(true));
    it('identifies PENDING as inactive', () => expect(isActiveState(JobState.PENDING)).toBe(false));
    it('identifies COMPLETED as inactive', () => expect(isActiveState(JobState.COMPLETED)).toBe(false));
  });

  describe('assertValidTransition', () => {
    it('does not throw for valid transition', () => {
      expect(() => assertValidTransition(JobState.PENDING, JobState.RUNNING)).not.toThrow();
    });

    it('throws StateTransitionError for invalid transition', () => {
      expect(() => assertValidTransition(JobState.COMPLETED, JobState.RUNNING))
        .toThrow(StateTransitionError);
    });

    it('error message includes states', () => {
      try {
        assertValidTransition(JobState.FAILED, JobState.PENDING);
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StateTransitionError);
        expect((err as Error).message).toContain('FAILED');
        expect((err as Error).message).toContain('PENDING');
      }
    });
  });

  describe('StateMachine class', () => {
    it('starts in given state', () => {
      const sm = new StateMachine(JobState.PENDING);
      expect(sm.getState()).toBe(JobState.PENDING);
    });

    it('transitions to new state', () => {
      const sm = new StateMachine(JobState.PENDING);
      const prev = sm.transition(JobState.RUNNING);
      expect(prev).toBe(JobState.PENDING);
      expect(sm.getState()).toBe(JobState.RUNNING);
    });

    it('throws on invalid transition', () => {
      const sm = new StateMachine(JobState.COMPLETED);
      expect(() => sm.transition(JobState.RUNNING)).toThrow(StateTransitionError);
    });

    it('correctly reports terminal state', () => {
      const sm = new StateMachine(JobState.COMPLETED);
      expect(sm.isTerminal()).toBe(true);
    });

    it('correctly reports non-terminal state', () => {
      const sm = new StateMachine(JobState.RUNNING);
      expect(sm.isTerminal()).toBe(false);
    });

    it('allows sequential valid transitions', () => {
      const sm = new StateMachine(JobState.PENDING);
      sm.transition(JobState.RUNNING);
      sm.transition(JobState.RETRYING);
      sm.transition(JobState.RUNNING);
      sm.transition(JobState.COMPLETED);
      expect(sm.getState()).toBe(JobState.COMPLETED);
      expect(sm.isTerminal()).toBe(true);
    });

    it('canTransition returns correct boolean', () => {
      const sm = new StateMachine(JobState.RUNNING);
      expect(sm.canTransition(JobState.COMPLETED)).toBe(true);
      expect(sm.canTransition(JobState.PENDING)).toBe(false);
    });
  });
});
