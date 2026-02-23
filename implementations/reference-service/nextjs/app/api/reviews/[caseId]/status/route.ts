import { NextResponse } from 'next/server';
import { getCase, checkRateLimit } from '@/lib/hitl';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rl = checkRateLimit(rc.case_id);
  const headers = new Headers({
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rl.remaining),
  });

  if (!rl.allowed) {
    headers.set('Retry-After', '30');
    return NextResponse.json({ error: 'rate_limited', message: 'Wait 30 seconds.' }, { status: 429, headers });
  }

  const inm = request.headers.get('If-None-Match');
  if (inm && inm === rc.etag) {
    headers.set('ETag', rc.etag);
    return new NextResponse(null, { status: 304, headers });
  }

  const resp: Record<string, unknown> = { status: rc.status, case_id: rc.case_id, created_at: rc.created_at, expires_at: rc.expires_at };
  if (rc.opened_at) resp.opened_at = rc.opened_at;
  if (rc.completed_at) resp.completed_at = rc.completed_at;
  if (rc.expired_at) resp.expired_at = rc.expired_at;
  if (rc.cancelled_at) resp.cancelled_at = rc.cancelled_at;
  if (rc.result) resp.result = rc.result;
  if (rc.responded_by) resp.responded_by = rc.responded_by;
  if (rc.status === 'expired') resp.default_action = rc.default_action;

  headers.set('ETag', rc.etag);
  headers.set('Retry-After', '30');
  return NextResponse.json(resp, { headers });
}
