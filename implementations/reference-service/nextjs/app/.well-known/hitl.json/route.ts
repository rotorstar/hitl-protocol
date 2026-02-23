import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/hitl';

export async function GET() {
  const base = getBaseUrl();
  return NextResponse.json({
    hitl_protocol: {
      spec_version: '0.5',
      service: { name: 'HITL Reference Service (Next.js)', url: base },
      capabilities: {
        review_types: ['approval', 'selection', 'input', 'confirmation', 'escalation'],
        transports: ['polling', 'sse'],
        default_timeout: 'PT24H',
        supports_reminders: false,
        supports_multi_round: false,
        supports_signatures: false,
      },
      endpoints: { reviews_base: `${base}/api/reviews`, review_page_base: `${base}/review` },
      rate_limits: { poll_recommended_interval_seconds: 30, max_requests_per_minute: 60 },
    },
  }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
}
