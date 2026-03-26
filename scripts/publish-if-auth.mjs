import { spawnSync } from 'node:child_process'

const npmToken = process.env.NPM_TOKEN

if (!npmToken) {
  console.log('Skipping npm publish in CI: NPM_TOKEN is not configured.')
  process.exit(0)
}

const result = spawnSync('pnpm', ['run', 'publish'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
