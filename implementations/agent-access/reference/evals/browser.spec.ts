import { expect, test } from '@playwright/test'
import { EvalHarness, PUBLIC_BASE, completeLoginForm } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const h = new EvalHarness()
test.beforeAll(async () => { await h.start() })
test.afterAll(async () => { await h.close() })

test('E8: mobile, keyboard and JavaScript-free enrollment, review and explicit execution', async () => {
  const agent = await h.loginAgent('alice')
  const owner = await h.browser!.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 720 } })
  h.contexts.push(owner)
  await h.enroll(agent, owner)
  const offer = await h.offer({ price: 10001 })
  const prepared = await h.prepare(agent, h.input(agent, offer))
  const page = await owner.newPage()
  const requests: { url: string; referrer: string }[] = []
  page.on('request', (request) => requests.push({ url: request.url(), referrer: request.headers().referer ?? '' }))
  await page.goto(prepared.reviewUrl!)
  await expect(page.getByRole('heading', { name: 'Review booking proposal' })).toBeVisible()
  expect(new URL(page.url()).search).toBe('')
  await expect(page.getByText('No stock is reserved', { exact: false })).toBeVisible()
  await expect(page.locator('dd.total')).toHaveText('€100.01')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  let found = false
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    if (await page.getByRole('button', { name: 'Confirm proposal', exact: true }).evaluate((element) => element === document.activeElement)) { found = true; break }
  }
  expect(found).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Confirmation recorded.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm proposal', exact: true })).toHaveCount(0)
  const count = await h.pool.query<{ n: string }>('SELECT count(*) AS n FROM bookings WHERE operation_id=$1', [prepared.operation.operation_id])
  expect(count.rows[0]?.n).toBe('0')
  const committed = await h.commit(agent, prepared.operation)
  expect(committed.status).toBe(200)
  const token = new URL(prepared.reviewUrl!).searchParams.get('token')!
  expect(requests.filter((request) => request.url.includes(token))).toHaveLength(1)
  expect(requests.some((request) => request.referrer.includes(token))).toBe(false)
  expect(h.workers.some((worker) => worker.output().includes(token))).toBe(false)
  await page.goto(`${PUBLIC_BASE}/account/agents`)
  await expect(page.getByRole('heading', { name: 'Connected agents' })).toBeVisible()
  await expect(page.getByText('€500.00', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('bookings:commit', { exact: false }).first()).toBeVisible()
  await page.close()
})

test('E8: untrusted catalog text stays text and cancellation disables execution', async () => {
  await h.resetScenario()
  const agent = await h.loginAgent('bob')
  const owner = await h.context()
  await h.enroll(agent, owner)
  const offer = await h.offer({ price: 5000, refundable: false })
  const malicious = '<img src=x onerror="document.body.dataset.injected=1"><script>alert(1)</script>'
  await h.pool.query('UPDATE offers SET title=$2,terms=$2 WHERE id=$1', [offer, malicious])
  const prepared = await h.prepare(agent, h.input(agent, offer, 1, 2))
  const page = await h.openReview(owner, prepared)
  await expect(page.locator('img,script')).toHaveCount(0)
  await expect(page.getByText(malicious, { exact: true }).first()).toBeVisible()
  expect(await page.locator('body').getAttribute('data-injected')).toBeNull()
  await page.getByRole('button', { name: 'Decline proposal', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Proposal declined.' })).toBeVisible()
  expect((await h.commit(agent, prepared.operation)).status).toBe(409)
  await page.close()
})

test('E8: stale local authentication requires a new cross-site OIDC exchange with fresh verified auth_time', async () => {
  const owner = await h.context()
  const page = await owner.newPage()
  await page.goto(`${PUBLIC_BASE}/account/agents`)
  await completeLoginForm(page, 'alice')
  await expect(page.getByRole('heading', { name: 'Connected agents' })).toBeVisible()
  await h.rememberSession(owner)
  const cookie = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')!
  const { createHash } = await import('node:crypto')
  await h.pool.query("UPDATE browser_sessions SET identity=jsonb_set(identity,'{auth_time}',to_jsonb(extract(epoch from clock_timestamp())::bigint-301)) WHERE token_hash=$1", [createHash('sha256').update(cookie.value).digest('hex')])
  const exchanges: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/protocol/openid-connect/auth') || url.pathname === '/auth/callback') exchanges.push(url)
  })
  await page.goto(`${PUBLIC_BASE}/account/agents`)
  // Keycloak retains the selected username on its password-only reauth page.
  await expect(page.locator('#password')).toBeVisible()
  await completeLoginForm(page, 'alice')
  await expect(page.getByRole('heading', { name: 'Connected agents' })).toBeVisible()
  expect(exchanges.some((url) => url.pathname.endsWith('/protocol/openid-connect/auth') && url.searchParams.get('max_age') === '300' && url.searchParams.get('prompt') === 'login')).toBe(true)
  expect(exchanges.some((url) => url.pathname === '/auth/callback')).toBe(true)
  const rotated = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')!
  expect(rotated.value).not.toBe(cookie.value)
  const oldSession = await h.pool.query('SELECT token_hash FROM browser_sessions WHERE token_hash=$1', [createHash('sha256').update(cookie.value).digest('hex')])
  expect(oldSession.rowCount).toBe(0)
  const refreshed = await h.pool.query<{ identity: { auth_time: number } }>('SELECT identity FROM browser_sessions WHERE token_hash=$1', [createHash('sha256').update(rotated.value).digest('hex')])
  expect(Date.now() / 1000 - refreshed.rows[0]!.identity.auth_time).toBeLessThanOrEqual(300)
  const csrf = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-csrf')!
  expect(csrf.sameSite).toBe('Strict')
  expect((await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')?.sameSite).toBe('Lax')
  await page.close()
})
