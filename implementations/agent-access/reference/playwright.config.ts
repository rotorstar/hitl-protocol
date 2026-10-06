import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './evals', testMatch: 'browser.spec.ts', fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), failOnFlakyTests: true,
  retries: 0, timeout: 120_000, globalTimeout: 600_000,
  outputDir: '.eval/browser-artifacts',
  reporter: [['list'], ['json', { outputFile: '.eval/browser-results.json' }]],
  use: { headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
