/**
 * State machine tests — adapted from tests/node/state-machine.test.js.
 * Tests the core transition logic with ReviewCase objects.
 */

import { describe, it, expect } from 'vitest'

import {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  canTransition,
  transition,
} from '../index.js'
import type { ReviewCase, ReviewStatus } from '../index.js'
import { hashToken, generateToken } from '../index.js'

function makeCase(status: ReviewStatus = 'pending'): ReviewCase {
  return {
    case_id: 'test_001',
    type: 'approval',
    status,
    prompt: 'Test prompt',
    token_hash: hashToken(generateToken()),
    submit_token_hash: hashToken(generateToken()),
    inline_actions: ['approve', 'reject'],
    context: {},
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    default_action: 'skip',
    version: 1,
    etag: '"v1-pending"',
    result: null,
    responded_by: null,
  }
}

// ============================================================
// Valid Transitions
// ============================================================

describe('State Machine — Valid Transitions', () => {
  const validTransitions: [ReviewStatus, ReviewStatus][] = [
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
  ]

  validTransitions.forEach(([from, to]) => {
    it(`allows: ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true)
      const rc = makeCase(from)
      transition(rc, to)
      expect(rc.status).toBe(to)
    })
  })
})

// ============================================================
// Invalid Transitions
// ============================================================

describe('State Machine — Invalid Transitions', () => {
  const invalidTransitions: [ReviewStatus, ReviewStatus][] = [
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
    ['opened', 'pending'],
    ['in_progress', 'pending'],
    ['in_progress', 'opened'],
    ['pending', 'in_progress'],
    ['pending', 'completed'],
  ]

  invalidTransitions.forEach(([from, to]) => {
    it(`rejects: ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false)
      const rc = makeCase(from)
      expect(() => transition(rc, to)).toThrow('Invalid transition')
    })
  })
})

// ============================================================
// Terminal States
// ============================================================

describe('State Machine — Terminal States', () => {
  it('TERMINAL_STATES contains exactly 3 states', () => {
    expect(TERMINAL_STATES).toHaveLength(3)
    expect(TERMINAL_STATES).toContain('completed')
    expect(TERMINAL_STATES).toContain('expired')
    expect(TERMINAL_STATES).toContain('cancelled')
  })

  const allStates: ReviewStatus[] = ['pending', 'opened', 'in_progress', 'completed', 'expired', 'cancelled']

  TERMINAL_STATES.forEach((terminal) => {
    it(`${terminal} has no valid transitions`, () => {
      expect(VALID_TRANSITIONS[terminal]).toEqual([])
      allStates.forEach((target) => {
        expect(canTransition(terminal, target)).toBe(false)
      })
    })
  })
})

// ============================================================
// State Update Side Effects
// ============================================================

describe('State Machine — State Updates', () => {
  it('updates status, timestamp, version, and etag', () => {
    const rc = makeCase('pending')
    transition(rc, 'opened')
    expect(rc.status).toBe('opened')
    expect(rc.opened_at).toBeDefined()
    expect(rc.version).toBe(2)
    expect(rc.etag).toBe('"v2-opened"')
  })

  it('increments version on each transition', () => {
    const rc = makeCase('pending')
    transition(rc, 'opened')
    expect(rc.version).toBe(2)
    transition(rc, 'in_progress')
    expect(rc.version).toBe(3)
    transition(rc, 'completed')
    expect(rc.version).toBe(4)
  })

  it('calls onTransition callback after state update', () => {
    const rc = makeCase('pending')
    let callbackRc: ReviewCase | undefined
    transition(rc, 'opened', (r) => { callbackRc = r })
    expect(callbackRc).toBe(rc)
    expect(callbackRc?.status).toBe('opened')
  })

  it('does not call onTransition on invalid transition', () => {
    const rc = makeCase('completed')
    let called = false
    expect(() => transition(rc, 'pending', () => { called = true })).toThrow()
    expect(called).toBe(false)
  })
})

// ============================================================
// Happy Paths
// ============================================================

describe('State Machine — Happy Paths', () => {
  it('simple flow: pending → opened → completed', () => {
    const rc = makeCase('pending')
    transition(rc, 'opened')
    transition(rc, 'completed')
    expect(rc.status).toBe('completed')
    expect(rc.version).toBe(3)
  })

  it('multi-step flow: pending → opened → in_progress → completed', () => {
    const rc = makeCase('pending')
    transition(rc, 'opened')
    transition(rc, 'in_progress')
    transition(rc, 'completed')
    expect(rc.status).toBe('completed')
    expect(rc.version).toBe(4)
  })

  it('expired before opening: pending → expired', () => {
    const rc = makeCase('pending')
    transition(rc, 'expired')
    expect(rc.status).toBe('expired')
  })

  it('cancelled during progress: pending → opened → in_progress → cancelled', () => {
    const rc = makeCase('pending')
    transition(rc, 'opened')
    transition(rc, 'in_progress')
    transition(rc, 'cancelled')
    expect(rc.status).toBe('cancelled')
  })
})

// ============================================================
// Coverage
// ============================================================

describe('State Machine — Coverage', () => {
  it('defines exactly 6 states', () => {
    expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(6)
  })

  it('all states are accounted for', () => {
    const states = Object.keys(VALID_TRANSITIONS)
    expect(states).toContain('pending')
    expect(states).toContain('opened')
    expect(states).toContain('in_progress')
    expect(states).toContain('completed')
    expect(states).toContain('expired')
    expect(states).toContain('cancelled')
  })
})
