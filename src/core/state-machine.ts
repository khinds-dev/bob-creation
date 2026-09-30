// ============================================================
// src/core/state-machine.ts
// Job lifecycle state machine with valid transition enforcement
// ============================================================

import { JobState } from '../types';

export class StateTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'StateTransitionError';
  }
}

// Valid transitions map: from state -> allowed to states
const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  [JobState.PENDING]: [JobState.RUNNING, JobState.CANCELLED],
  [JobState.RUNNING]: [JobState.COMPLETED, JobState.FAILED, JobState.RETRYING, JobState.CANCELLED],
  [JobState.RETRYING]: [JobState.RUNNING, JobState.FAILED, JobState.CANCELLED],
  [JobState.COMPLETED]: [],
  [JobState.FAILED]: [],
  [JobState.CANCELLED]: [],
};

export function isValidTransition(from: JobState, to: JobState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: JobState, to: JobState): void {
  if (!isValidTransition(from, to)) {
    throw new StateTransitionError(from, to);
  }
}

export function isTerminalState(state: JobState): boolean {
  return (
    state === JobState.COMPLETED ||
    state === JobState.FAILED ||
    state === JobState.CANCELLED
  );
}

export function isActiveState(state: JobState): boolean {
  return state === JobState.RUNNING || state === JobState.RETRYING;
}

export class StateMachine {
  private state: JobState;

  constructor(initialState: JobState = JobState.PENDING) {
    this.state = initialState;
  }

  getState(): JobState {
    return this.state;
  }

  canTransition(to: JobState): boolean {
    return isValidTransition(this.state, to);
  }

  transition(to: JobState): JobState {
    assertValidTransition(this.state, to);
    const prev = this.state;
    this.state = to;
    return prev;
  }

  isTerminal(): boolean {
    return isTerminalState(this.state);
  }
}
