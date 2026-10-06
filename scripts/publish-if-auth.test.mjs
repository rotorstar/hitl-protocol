import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./publish-if-auth.mjs', import.meta.url))
async function withFakePublisher(run) {
  const directory = await mkdtemp(join(tmpdir(), 'hitl-publish-gate-'))
  const receipt = join(directory, 'invocation.json')
  try {
    const entry = join(directory, 'pnpm')
    await writeFile(entry, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify({args:process.argv.slice(2),output:process.env.CHANGESETS_OUTPUT}));\nprocess.exit(Number(process.env.FIXTURE_EXIT ?? 0));\n`, { mode: 0o700 })
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    const env = { ...process.env, PATH: directory, FIXTURE_RECEIPT: receipt, CHANGESETS_OUTPUT: 'fixture-output' }
    delete env.NODE_AUTH_TOKEN; delete env.NPM_TOKEN
    await run(env, receipt)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('missing registry credentials never invoke publishing', async () => withFakePublisher(async (env, receipt) => {
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /NODE_AUTH_TOKEN is not configured/)
  await assert.rejects(readFile(receipt), { code: 'ENOENT' })
}))

test('CI publishes already built packages without invoking workspace build scripts', async () => withFakePublisher(async (env, receipt) => {
  const result = spawnSync(process.execPath, [script], { env: { ...env, NODE_AUTH_TOKEN: 'fixture-never-sent-to-a-registry' }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), { args: ['exec', 'changeset', 'publish'], output: 'fixture-output' })
}))

test('publisher errors fail the CI wrapper', async () => withFakePublisher(async (env) => {
  const result = spawnSync(process.execPath, [script], { env: { ...env, NODE_AUTH_TOKEN: 'fixture', FIXTURE_EXIT: '23' } })
  assert.equal(result.status, 23)
}))
