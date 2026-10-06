import { NextResponse } from 'next/server';
import { getCase, verifyTokenForPurpose, ReviewError, parseSubmission, completeCase, handleTransition } from '@/lib/hitl';

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return NextResponse.json({ error: 'not_found', message: 'Review case not found.' }, { status: 404 });

  // v0.7: Determine auth path — Bearer header (inline) vs query param (review page)
  const authHeader = request.headers.get('Authorization');
  let isInlineSubmit = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Inline submit path: verify against submit_token_hash
    const bearerToken = authHeader.slice(7);
    if (!verifyTokenForPurpose(bearerToken, rc, 'submit')) {
      return NextResponse.json({ error: 'invalid_token', message: 'Invalid submit token.' }, { status: 401 });
    }
    isInlineSubmit = true;
  } else {
    // Review page path: verify against review token_hash (query param)
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token || !verifyTokenForPurpose(token, rc, 'review')) {
      return NextResponse.json({ error: 'invalid_token', message: 'Invalid or expired review token.' }, { status: 401 });
    }
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json', message: 'Expected JSON.' }, { status: 400 }); }
  try {
    const submission = parseSubmission(body, rc, isInlineSubmit ? 'inline_submit' : 'browser_submit');
    completeCase(rc, submission, handleTransition);
    return NextResponse.json({ status: 'completed', case_id: rc.case_id, completed_at: rc.completed_at });
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return NextResponse.json({ error: error.code, message: error.message, case_id: rc.case_id }, { status: error.status });
  }
}
