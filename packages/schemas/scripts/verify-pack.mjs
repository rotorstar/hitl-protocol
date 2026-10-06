/** Verify published imports, declarations, and local schema closure without downloads. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'hitl-schema-pack-'))
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--loglevel=error', '--cache', join(temporary, 'npm-cache'), '--json', '--pack-destination', temporary], { cwd: packageDirectory, encoding: 'utf8' }))
  const scope = join(temporary, 'node_modules', '@hitl-protocol')
  mkdirSync(scope, { recursive: true })
  execFileSync('tar', ['-xf', join(temporary, packed[0].filename), '-C', scope])
  const artifact = join(scope, 'schemas')
  renameSync(join(scope, 'package'), artifact)
  for (const dependency of ['ajv', 'ajv-formats']) symlinkSync(dirname(require.resolve(`${dependency}/package.json`)), join(temporary, 'node_modules', dependency), 'dir')
  const metadata = JSON.parse(readFileSync(join(artifact, 'package.json'), 'utf8'))
  for (const [key, entry] of Object.entries(metadata.exports)) {
    const targets = typeof entry === 'string' ? [entry] : Object.values(entry)
    for (const target of targets) assert(readFileSync(join(artifact, target)).length > 0, `Missing export ${key}`)
  }
  function closure(file, seen = new Set()) {
    const path = resolve(file)
    if (seen.has(path)) return
    seen.add(path)
    const schema = JSON.parse(readFileSync(path, 'utf8'))
    function visit(value) {
      if (!value || typeof value !== 'object') return
      if (typeof value.$ref === 'string') {
        const relative = value.$ref.split('#')[0]
        assert(!/^https?:/.test(relative), 'Raw schemas must resolve without network access')
        if (relative) closure(join(dirname(path), relative), seen)
      }
      for (const child of Object.values(value)) visit(child)
    }
    visit(schema)
  }
  for (const entry of Object.values(metadata.exports)) if (typeof entry === 'string') closure(join(artifact, entry))
  writeFileSync(join(temporary, 'consumer.mjs'), `
import assert from 'node:assert/strict'
import * as current from '@hitl-protocol/schemas'
import * as old from '@hitl-protocol/schemas/v0.8'
import * as next from '@hitl-protocol/schemas/v0.9'
assert.equal(current.hitlObjectSchema.properties.spec_version.const, '0.9')
assert.equal(old.hitlObjectSchema.properties.spec_version.const, '0.8')
assert.equal(next.validateDiscoveryResponse({hitl_protocol:{spec_version:'0.9'}}), true)
assert.equal(old.validateDiscoveryResponse({hitl_protocol:{spec_version:'0.8'}}), true)
assert.equal(current.validateSupportedDiscoveryResponse({hitl_protocol:{spec_version:'1.0'}}), false)
`)
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' })
  writeFileSync(join(temporary, 'consumer.mts'), `
import type { HitlObject, PollResponse, CustomReviewType } from '@hitl-protocol/schemas'
import type { HitlObject as V08 } from '@hitl-protocol/schemas/v0.8'
import type { HitlObject as V09 } from '@hitl-protocol/schemas/v0.9'
const current: HitlObject['spec_version'] = '0.9'
const old: V08['spec_version'] = '0.8'
const next: V09['spec_version'] = '0.9'
const custom: CustomReviewType = 'x-test'
// @ts-expect-error package default is exclusively v0.9
const wrongVersion: HitlObject['spec_version'] = '0.8'
// @ts-expect-error completed payload guarantees a result
const invalid: PollResponse = {status:'completed',case_id:'1',completed_at:'2026-10-06T00:00:00Z'}
void [current, old, next, custom, wrongVersion, invalid]
`)
  const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
  const publicNames = readFileSync(join(packageDirectory, 'src', 'type-fixtures', 'public-names.ts'), 'utf8')
    .replace("'../v0.8.js'", "'@hitl-protocol/schemas/v0.8'")
    .replace("'../v0.9.js'", "'@hitl-protocol/schemas/v0.9'")
  writeFileSync(join(temporary, 'public-names.mts'), publicNames)
  execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', 'consumer.mts', 'public-names.mts'], { cwd: temporary, stdio: 'inherit' })
  console.log('Packed v0.8/v0.9 imports, public declarations, and offline raw-schema closure verified.')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
