import { NextResponse } from 'next/server';
import { getCase, verifyToken, transition } from '@/lib/hitl';

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token || !verifyToken(token, rc.token_hash)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }
  if (rc.status === 'expired') {
    return NextResponse.json({ error: 'case_expired', message: `Expired on ${rc.expires_at}.` }, { status: 410 });
  }
  if (rc.status === 'completed') {
    return NextResponse.json({ error: 'duplicate_submission', message: 'Already responded.' }, { status: 409 });
  }

  const body = await request.json();
  if (!body.action) return NextResponse.json({ error: 'missing_action' }, { status: 400 });

  rc.result = { action: body.action, data: body.data || {} };
  rc.responded_by = { name: 'Demo User', email: 'demo@example.com' };
  transition(rc, 'completed');

  return NextResponse.json({ status: 'completed', case_id: rc.case_id, completed_at: rc.completed_at });
}
