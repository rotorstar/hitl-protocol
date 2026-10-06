import { spawnSync } from 'node:child_process'

const npmToken = process.env.NODE_AUTH_TOKEN

if (!npmToken) {
  console.log('Skipping npm publish in CI: NODE_AUTH_TOKEN is not configured.')
  process.exit(0)
}

// CI already built the evaluated checkout before introducing registry credentials.
// Never expose those credentials to a second workspace/demo build.
const result = spawnSync('pnpm', ['exec', 'changeset', 'publish'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
