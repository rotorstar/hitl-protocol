/**
 * HITL Protocol v0.5 — State Machine Tests
 *
 * Validates all state transitions as defined in Spec Section 8.
 * 6 states: pending, opened, in_progress, completed, expired, cancelled
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// Pure state machine (extracted for testing)
// ============================================================

const VALID_TRANSITIONS = {
  pending:     ['opened', 'expired', 'cancelled'],
  opened:      ['in_progress', 'completed', 'expired', 'cancelled'],
  in_progress: ['completed', 'expired', 'cancelled'],
  completed:   [],
  expired:     [],
  cancelled:   [],
};

function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

function transition(currentStatus, newStatus) {
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
  }
  return newStatus;
}

// ============================================================
// Valid Transitions
// ============================================================

describe('State Machine — Valid Transitions', () => {
  const validTransitions = [
    ['pending', 'opened'],
    ['pending', 'expired'],
    ['pending', 'cancelled'],
    ['opened', 'in_progress'],
    ['opened', 'completed'],
    ['opened', 'expired'],
    ['opened', 'cancelled'],
    ['in_progress', 'completed'],
    ['in_progress', 'expired'],
    ['in_progress', 'cancelled'],
  ];

  validTransitions.forEach(([from, to]) => {
    it(`allows: ${from} → ${to}`, () => {
      expect(transition(from, to)).toBe(to);
    });
  });
});

// ============================================================
// Invalid Transitions
// ============================================================

describe('State Machine — Invalid Transitions', () => {
  const invalidTransitions = [
    // Terminal states → anything
    ['completed', 'pending'],
    ['completed', 'opened'],
    ['completed', 'in_progress'],
    ['completed', 'expired'],
    ['completed', 'cancelled'],
    ['expired', 'pending'],
    ['expired', 'opened'],
    ['expired', 'completed'],
    ['expired', 'cancelled'],
    ['cancelled', 'pending'],
    ['cancelled', 'opened'],
    ['cancelled', 'completed'],
    ['cancelled', 'expired'],
    // Backward transitions
    ['opened', 'pending'],
    ['in_progress', 'pending'],
    ['in_progress', 'opened'],
    // Skip transitions
    ['pending', 'in_progress'],
    ['pending', 'completed'],
  ];

  invalidTransitions.forEach(([from, to]) => {
    it(`rejects: ${from} → ${to}`, () => {
      expect(() => transition(from, to)).toThrow('Invalid transition');
    });
  });
});

// ============================================================
// Terminal States
// ============================================================

describe('State Machine — Terminal States', () => {
  const terminalStates = ['completed', 'expired', 'cancelled'];
  const allStates = ['pending', 'opened', 'in_progress', 'completed', 'expired', 'cancelled'];

  terminalStates.forEach((terminal) => {
    it(`${terminal} has no valid transitions`, () => {
      expect(VALID_TRANSITIONS[terminal]).toEqual([]);
      allStates.forEach((target) => {
        expect(canTransition(terminal, target)).toBe(false);
      });
    });
  });
});

// ============================================================
// Happy Paths
// ============================================================

describe('State Machine — Happy Paths', () => {
  it('simple flow: pending → opened → completed', () => {
    let status = 'pending';
    status = transition(status, 'opened');
    status = transition(status, 'completed');
    expect(status).toBe('completed');
  });

  it('multi-step flow: pending → opened → in_progress → completed', () => {
    let status = 'pending';
    status = transition(status, 'opened');
    status = transition(status, 'in_progress');
    status = transition(status, 'completed');
    expect(status).toBe('completed');
  });

  it('expired before opening: pending → expired', () => {
    let status = 'pending';
    status = transition(status, 'expired');
    expect(status).toBe('expired');
  });

  it('cancelled during progress: pending → opened → in_progress → cancelled', () => {
    let status = 'pending';
    status = transition(status, 'opened');
    status = transition(status, 'in_progress');
    status = transition(status, 'cancelled');
    expect(status).toBe('cancelled');
  });
});

// ============================================================
// State Coverage
// ============================================================

describe('State Machine — Coverage', () => {
  it('defines exactly 6 states', () => {
    expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(6);
  });

  it('all states are accounted for', () => {
    const states = Object.keys(VALID_TRANSITIONS);
    expect(states).toContain('pending');
    expect(states).toContain('opened');
    expect(states).toContain('in_progress');
    expect(states).toContain('completed');
    expect(states).toContain('expired');
    expect(states).toContain('cancelled');
  });
});
