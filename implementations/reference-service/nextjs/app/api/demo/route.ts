import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { generateToken, hashToken, setCase, transition, handleTransition, SAMPLE_CONTEXTS, PROMPTS, INLINE_ACTIONS, getBaseUrl } from '@/lib/hitl';
import type { ReviewType, ReviewCase } from '@/lib/hitl';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || 'selection') as ReviewType;

  if (!SAMPLE_CONTEXTS[type]) {
    return NextResponse.json(
      { error: 'invalid_type', message: `Use: ${Object.keys(SAMPLE_CONTEXTS).join(', ')}` },
      { status: 400 },
    );
  }

  const base = getBaseUrl();
  const caseId = 'review_' + randomBytes(8).toString('hex');
  const token = generateToken();            // review URL token
  const submitToken = generateToken();      // v0.7: separate inline submit token
  const now = new Date();
  const expires = new Date(now.getTime() + 86400000);
  const inlineActions = INLINE_ACTIONS[type] || [];

  const rc: ReviewCase = {
    case_id: caseId, type, status: 'pending', prompt: PROMPTS[type],
    token_hash: hashToken(token),
    submit_token_hash: hashToken(submitToken),  // v0.7
    inline_actions: [...inlineActions],           // v0.7
    context: SAMPLE_CONTEXTS[type],
    created_at: now.toISOString(), expires_at: expires.toISOString(),
    default_action: 'skip', version: 1, etag: '"v1-pending"', result: null, responded_by: null,
  };
  setCase(caseId, rc);

  // Auto-expire
  setTimeout(() => {
    if (['pending', 'opened', 'in_progress'].includes(rc.status)) try { transition(rc, 'expired', handleTransition); } catch {}
  }, 86400000);

  return NextResponse.json({
    status: 'human_input_required', message: rc.prompt,
    hitl: {
      spec_version: '0.7', case_id: caseId,
      review_url: `${base}/review/${caseId}?token=${token}`,
      poll_url: `${base}/api/reviews/${caseId}/status`,
      // v0.7: Inline submit (only for types that support it)
      ...(inlineActions.length > 0 ? {
        submit_url: `${base}/api/reviews/${caseId}/respond`,
        submit_token: submitToken,
        inline_actions: inlineActions,
      } : {}),
      type, prompt: rc.prompt, timeout: '24h', default_action: 'skip',
      created_at: rc.created_at, expires_at: rc.expires_at, context: rc.context,
    },
  }, { status: 202, headers: { 'Retry-After': '30' } });
}
