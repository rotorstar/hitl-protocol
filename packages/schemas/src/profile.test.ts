import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const generator = new URL('../scripts/generate-profile.js', import.meta.url)
const path = new URL('../../../profiles/agent-access/v0.1/', import.meta.url)
const document: Record<string, unknown> = JSON.parse(readFileSync(new URL('openapi.json', path), 'utf8'))

describe('Agent Access public contract projection', () => {
  it('has no drift from canonical Zod and core JSON contracts', () => {
    expect(() => execFileSync(process.execPath, [generator.pathname, '--check'], { stdio: 'pipe' })).not.toThrow()
  })
  it('has a complete standalone OpenAPI reference graph', () => {
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return
      if ('$ref' in value) {
        const ref = value.$ref
        expect(typeof ref).toBe('string')
        if (typeof ref === 'string') {
          expect(ref.startsWith('#/')).toBe(true)
          let resolved: unknown = document
          for (const key of ref.slice(2).split('/')) {
            expect(resolved !== null && typeof resolved === 'object').toBe(true)
            resolved = (resolved as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')]
          }
          expect(resolved).toBeDefined()
        }
      }
      for (const child of Object.values(value)) visit(child)
    }
    visit(document)
    expect(document.openapi).toBe('3.2.1')
  })
  it('conjoins token and proof and never requires enrollment limits before defaults', () => {
    const components = document.components as { schemas: Record<string, { required?: string[] }> }
    expect(components.schemas.EnrollmentInput?.required ?? []).not.toContain('max_total_cents')
    const paths = document.paths as Record<string, { post?: { security?: unknown; requestBody?: unknown } }>
    expect(paths['/v1/operations/{id}/commit']?.post?.security).toEqual([{ DPoPAccessToken: [], DPoPProof: [] }])
    expect(paths['/v1/bookings/prepare']?.post?.requestBody).toBeDefined()
  })
})
