import { NextResponse } from 'next/server';
import { getCase, checkRateLimit, expireCase, handleTransition, pollCase } from '@/lib/hitl';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  expireCase(rc, handleTransition);

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

  const resp = pollCase(rc);

  headers.set('ETag', rc.etag);
  headers.set('Retry-After', '30');
  return NextResponse.json(resp, { headers });
}
