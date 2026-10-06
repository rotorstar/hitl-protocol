import { getCase, registerSSE, expireCase, handleTransition, pollCase } from '@/lib/hitl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  expireCase(rc, handleTransition);

  const encoder = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      // Send current status
      const initial = JSON.stringify(pollCase(rc));
      controller.enqueue(encoder.encode(`event: review.${rc.status}\ndata: ${initial}\nid: evt_init\n\n`));

      // Register for updates
      const unregister = registerSSE(caseId, controller);

      // Heartbeat
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { cleanup(); }
      }, 30000);

      // Store cleanup for disconnect handling
      cleanup = () => {
        clearInterval(heartbeat);
        unregister();
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
