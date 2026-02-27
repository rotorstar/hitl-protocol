import { NextResponse } from 'next/server';
import { getCase, verifyTokenForPurpose, transition, handleTransition, getBaseUrl } from '@/lib/hitl';

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

  // Check expired
  if (rc.status === 'expired') {
    return NextResponse.json({ error: 'case_expired', message: `This review case expired on ${rc.expires_at}.` }, { status: 410 });
  }

  // One-time response (409)
  if (rc.status === 'completed') {
    return NextResponse.json({ error: 'duplicate_submission', message: 'This review case has already been responded to.' }, { status: 409 });
  }

  const { action, data, submitted_via, submitted_by } = await request.json();
  if (!action) return NextResponse.json({ error: 'missing_action', message: 'Request body must include "action".' }, { status: 400 });

  // v0.7: Validate inline_actions for Bearer path
  if (isInlineSubmit && rc.inline_actions?.length > 0 && !rc.inline_actions.includes(action)) {
    const base = getBaseUrl();
    return NextResponse.json({
      error: 'action_not_inline',
      message: `Action '${action}' is not allowed via inline submit. Use the original hitl.review_url for full review.`,
      case_id: rc.case_id,
      review_url: `${base}/review/${rc.case_id}`,
    }, { status: 403 });
  }

  rc.result = { action, data: data || {} };
  rc.responded_by = submitted_by || { name: 'Demo User', email: 'demo@example.com' };
  if (submitted_via) rc.submitted_via = submitted_via;
  transition(rc, 'completed', handleTransition);

  return NextResponse.json({ status: 'completed', case_id: rc.case_id, completed_at: rc.completed_at });
}
