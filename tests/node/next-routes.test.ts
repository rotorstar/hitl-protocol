import { describe, it, expect, afterEach, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validatePollResponse } from '@hitl-protocol/schemas/v0.8'
import { POST as create } from '../../implementations/reference-service/nextjs/app/api/demo/route'
import { POST as respond } from '../../implementations/reference-service/nextjs/app/api/reviews/[caseId]/respond/route'
import { GET as status } from '../../implementations/reference-service/nextjs/app/api/reviews/[caseId]/status/route'
import { GET as events } from '../../implementations/reference-service/nextjs/app/api/reviews/[caseId]/events/route'
import { getCase, resetCases } from '../../implementations/reference-service/nextjs/lib/hitl'
import ReviewPage from '../../implementations/reference-service/nextjs/app/review/[caseId]/page'

afterEach(() => { resetCases(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const body = (action = 'confirm') => ({ action, submitted_via: 'x-cli', submitted_by: { platform: 'x-cli', platform_user_id: 'claimed' } })

async function newCase() {
  vi.useFakeTimers()
  return (await (await create(new Request('http://localhost/api/demo?type=confirmation', { method: 'POST' }))).json()).hitl as { case_id: string; submit_token: string }
}
function params(caseId: string) { return { params: Promise.resolve({ caseId }) } }
function request(hitl: { case_id: string; submit_token: string }, action = 'confirm') {
  return new Request(`http://localhost/api/reviews/${hitl.case_id}/respond`, { method: 'POST', headers: { authorization: `Bearer ${hitl.submit_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body(action)) })
}

describe('Actual Next route handlers', () => {
  it.each(['constructor', '__proto__', 'toString', 'unknown'])('rejects undeclared review type %s without creating a case', async (type) => {
    const response = await create(new Request(`http://localhost/api/demo?type=${type}`, { method: 'POST' }))
    expect(response.status).toBe(400)
  })
  it('renders hostile text and literal placeholders without reinterpreting replacements', async () => {
    vi.useFakeTimers()
    vi.stubEnv('BASE_URL', 'http://localhost')
    const hitl = (await (await create(new Request('http://localhost/api/demo?type=confirmation', { method: 'POST' }))).json()).hitl
    const token = new URL(hitl.review_url).searchParams.get('token')!
    const rc = getCase(hitl.case_id)!
    rc.prompt = "$& $` $' {{hitl_data_json}} {{prompt}} </script><script>alert(1)</script>"
    rc.context = { description: rc.prompt }
    vi.spyOn(process, 'cwd').mockReturnValue(fileURLToPath(new URL('../../implementations/reference-service/nextjs', import.meta.url)))
    const page = await ReviewPage({ params: Promise.resolve({ caseId: hitl.case_id }), searchParams: Promise.resolve({ token }) })
    const html = page.props.dangerouslySetInnerHTML.__html as string
    expect(html).not.toContain('</script><script>alert(1)</script>')
    const rendered = JSON.parse(html.split('id="hitl-data">')[1].split('</script>')[0])
    expect(rendered.prompt).toBe(rc.prompt)
    expect(rendered.context).toEqual(rc.context)
  })
  it('completes unopened inline cases with a schema-valid poll contract', async () => {
    const hitl = await newCase()
    expect((await respond(request(hitl), params(hitl.case_id))).status).toBe(200)
    const poll = await (await status(new Request('http://localhost/status'), params(hitl.case_id))).json()
    expect(validatePollResponse(poll)).toBe(true)
    expect(poll).not.toHaveProperty('responded_by')
    expect(poll.submission_context.mode).toBe('inline_submit')
  })
  it('rechecks terminal state after both request bodies begin parsing', async () => {
    const hitl = await newCase()
    let finishFirst!: (value: unknown) => void
    let finishSecond!: (value: unknown) => void
    const first = request(hitl); const second = request(hitl, 'cancel')
    first.json = () => new Promise((resolve) => { finishFirst = resolve })
    second.json = () => new Promise((resolve) => { finishSecond = resolve })
    const responses = [respond(first, params(hitl.case_id)), respond(second, params(hitl.case_id))]
    await Promise.resolve(); await Promise.resolve()
    finishFirst(body('confirm')); await responses[0]
    finishSecond(body('cancel'))
    expect((await responses[1]).status).toBe(409)
    expect(getCase(hitl.case_id)?.result?.action).toBe('confirm')
  })
  it('checks the deadline after body parsing and never writes an expired result', async () => {
    const hitl = await newCase()
    const rc = getCase(hitl.case_id)!
    const submit = request(hitl)
    submit.json = async () => { rc.expires_at = '2000-01-01T00:00:00Z'; return body() }
    expect((await respond(submit, params(hitl.case_id))).status).toBe(410)
    expect(rc.result).toBeNull()
  })
  it('cleans up SSE when cancellation supplies a reason, not a controller', async () => {
    const hitl = await newCase()
    const baseline = vi.getTimerCount()
    const response = await events(new Request('http://localhost/events'), params(hitl.case_id))
    expect(vi.getTimerCount()).toBe(baseline + 1)
    await response.body!.cancel('client disconnected')
    expect(vi.getTimerCount()).toBe(baseline)
  })
})
