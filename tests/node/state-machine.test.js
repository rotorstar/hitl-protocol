/** Contract tests exercise the real shared runtime, never a copied graph. */
import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS, canTransition, transition, generateToken, hashToken } from '../../packages/core/src/index.ts';

describe('Public core state contract', () => {
  it('supports unopened inline decisions and preserves terminal states', () => {
    const rc = { case_id: 'case_contract', type: 'confirmation', status: 'pending', prompt: 'Confirm', token_hash: hashToken(generateToken()), inline_actions: [], context: {}, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1000).toISOString(), default_action: 'abort', version: 1, etag: '"v1-pending"', result: null, responded_by: null };
    expect(canTransition('pending', 'completed')).toBe(true);
    transition(rc, 'completed');
    expect(rc.completed_at).toBeDefined();
    expect(Object.keys(VALID_TRANSITIONS)).toHaveLength(6);
    for (const target of Object.keys(VALID_TRANSITIONS)) expect(canTransition('completed', target)).toBe(false);
  });
});
