import { describe, it, expect } from 'vitest'

import { INLINE_ACTIONS, PROMPTS, SAMPLE_CONTEXTS } from '../index.js'

const REVIEW_TYPES = ['approval', 'selection', 'input', 'confirmation', 'escalation'] as const

describe('Constants', () => {
  describe('INLINE_ACTIONS', () => {
    it('defines actions for all 5 review types', () => {
      REVIEW_TYPES.forEach((type) => {
        expect(INLINE_ACTIONS[type]).toBeDefined()
        expect(Array.isArray(INLINE_ACTIONS[type])).toBe(true)
      })
    })

    it('confirmation has confirm and cancel', () => {
      expect(INLINE_ACTIONS.confirmation).toEqual(['confirm', 'cancel'])
    })

    it('escalation has retry, skip, abort', () => {
      expect(INLINE_ACTIONS.escalation).toEqual(['retry', 'skip', 'abort'])
    })

    it('approval has approve and reject', () => {
      expect(INLINE_ACTIONS.approval).toEqual(['approve', 'reject'])
    })

    it('selection and input are empty (URL-only)', () => {
      expect(INLINE_ACTIONS.selection).toEqual([])
      expect(INLINE_ACTIONS.input).toEqual([])
    })
  })

  describe('PROMPTS', () => {
    it('defines prompts for all 5 review types', () => {
      REVIEW_TYPES.forEach((type) => {
        expect(PROMPTS[type]).toBeDefined()
        expect(typeof PROMPTS[type]).toBe('string')
        expect(PROMPTS[type].length).toBeGreaterThan(0)
      })
    })
  })

  describe('SAMPLE_CONTEXTS', () => {
    it('defines contexts for all 5 review types', () => {
      REVIEW_TYPES.forEach((type) => {
        expect(SAMPLE_CONTEXTS[type]).toBeDefined()
        expect(typeof SAMPLE_CONTEXTS[type]).toBe('object')
      })
    })

    it('selection context has items array', () => {
      const ctx = SAMPLE_CONTEXTS.selection as { items: unknown[] }
      expect(Array.isArray(ctx.items)).toBe(true)
      expect(ctx.items.length).toBeGreaterThan(0)
    })

    it('approval context has artifact', () => {
      const ctx = SAMPLE_CONTEXTS.approval as { artifact: { title: string } }
      expect(ctx.artifact).toBeDefined()
      expect(ctx.artifact.title).toBeDefined()
    })

    it('input context has form with fields', () => {
      const ctx = SAMPLE_CONTEXTS.input as { form: { fields: unknown[] } }
      expect(ctx.form).toBeDefined()
      expect(Array.isArray(ctx.form.fields)).toBe(true)
    })
  })
})
