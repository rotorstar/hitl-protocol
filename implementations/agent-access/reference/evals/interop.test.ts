import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { EvalHarness, PUBLIC_BASE, completeLoginForm } from './helpers.js'
import { IndependentClient, requireSupportedBindings } from './independent-client.js'

const h = new EvalHarness()
beforeAll(async () => { await h.start({ callbackServer: false }) }, 60000)
afterAll(async () => { await h.close() }, 30000)

it('E12: a client with no repository SDK discovers and completes the published delegated flow', async () => {
  const client = await IndependentClient.discover(PUBLIC_BASE)
  const agentBrowser = await h.context()
  const authPage = await agentBrowser.newPage()
  authPage.setDefaultTimeout(15000)
  await client.login(authPage, 'alice')
  await authPage.close()
  // The independently discovered catalogue still carries genuine DB rows;
  // isolate the booking fixture so repeated evals do not consume demo stock.
  const offerId = await h.offer({ price: 10001 })
  const catalog = await fetch(`${PUBLIC_BASE}/v1/catalog`).then((response) => response.json()) as { offers: { id: string; version: number }[] }
  expect(catalog.offers.length).toBeGreaterThan(0)
  const created = await client.request('/v1/agent-enrollments', 'POST', { display_name: 'Independent interoperability client' })
  expect(created.status).toBe(201)
  const owner = await h.context(), page = await owner.newPage()
  page.setDefaultTimeout(15000)
  await page.goto(String(created.body.verification_url))
  await completeLoginForm(page, 'alice')
  await page.getByRole('button', { name: 'Connect this agent', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Connection confirmed.' }).waitFor()
  await h.rememberSession(owner)
  const connected = await client.request(`/v1/agent-enrollments/${String(created.body.id)}`)
  expect(connected.status).toBe(200)
  expect(connected.body.status).toBe('confirmed')
  const offer = catalog.offers.find((entry) => entry.id === offerId)!
  const prepare = await client.request('/v1/bookings/prepare', 'POST', { grant_id: connected.body.grant_id, offer_id: offer.id, offer_version: offer.version, quantity: 1 }, randomUUID())
  expect(prepare.status).toBe(202)
  const hitl = prepare.body.hitl as { review_url: string; poll_url: string; context: { 'x-hitl-agent-access': { operation_id: string; operation_version: number; snapshot_digest: string } } }
  const binding = hitl.context['x-hitl-agent-access']
  await page.goto(hitl.review_url)
  await page.getByRole('button', { name: 'Confirm proposal', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Confirmation recorded.' }).waitFor()
  const poll = await client.request(new URL(hitl.poll_url).pathname)
  expect(poll.status).toBe(200); expect(poll.body.status).toBe('completed')
  const operation = await client.request(`/v1/operations/${binding.operation_id}`)
  expect(operation.status).toBe(200); expect(operation.body.status).toBe('ready')
  const committed = await client.request(`/v1/operations/${binding.operation_id}/commit`, 'POST', { expected_version: binding.operation_version, snapshot_digest: binding.snapshot_digest })
  expect(committed.status).toBe(200); expect(committed.body.status).toBe('succeeded')
  const booking = await h.pool.query<{ n: string }>('SELECT count(*) AS n FROM bookings WHERE operation_id=$1', [binding.operation_id])
  expect(booking.rows[0]?.n).toBe('1')
  await page.close()
}, 120000)

it('E12: an unknown mandatory operation binding stops an independent client before execution', () => {
  expect(() => requireSupportedBindings({ paths: { '/v1/operations/{id}/commit': { post: { 'x-hitl-agent-access-binding': 'future-unimplemented-binding/1.0' } } } })).toThrow('Unsupported required binding')
})
