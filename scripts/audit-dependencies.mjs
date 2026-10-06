import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** Fail closed on registry/network errors, unknown output or inconsistent exit status. */
export function assessAudit(report, exitCode) {
  const counts = report?.metadata?.vulnerabilities
  const severities = ['info', 'low', 'moderate', 'high', 'critical']
  if (!counts || severities.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
    || !report.advisories || typeof report.advisories !== 'object' || Array.isArray(report.advisories)
    || report.error || ![0, 1].includes(exitCode)) throw new Error('Dependency audit did not return a valid complete report')
  const advisories = Object.values(report.advisories)
  const total = severities.reduce((sum, key) => sum + counts[key], 0)
  if (total || advisories.length) return { passed: false, counts, advisories }
  if (exitCode !== 0) throw new Error('Dependency audit failed despite an empty advisory report')
  return { passed: true, counts, advisories }
}

async function main() {
  const result = spawnSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (result.error || result.signal) throw new Error('Dependency audit could not complete')
  const report = JSON.parse(result.stdout)
  await mkdir('.eval', { recursive: true })
  await writeFile('.eval/dependency-security-audit.json', `${JSON.stringify(report, null, 2)}\n`)
  const outcome = assessAudit(report, result.status)
  console.log(`Dependency security audit: ${JSON.stringify(outcome.counts)}`)
  if (!outcome.passed) {
    for (const item of outcome.advisories) console.error(`${item.severity}: ${item.module_name} (${item.github_advisory_id ?? item.url})`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof SyntaxError ? 'Dependency audit returned invalid JSON' : error.message)
    process.exitCode = 1
  })
}
