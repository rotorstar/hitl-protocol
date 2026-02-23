import { getCase, registerSSE } from '@/lib/hitl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const rc = getCase(caseId);
  if (!rc) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current status
      const initial = JSON.stringify({ case_id: rc.case_id, status: rc.status });
      controller.enqueue(encoder.encode(`event: review.${rc.status}\ndata: ${initial}\nid: evt_init\n\n`));

      // Register for updates
      const unregister = registerSSE(caseId, controller);

      // Heartbeat
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { clearInterval(heartbeat); }
      }, 30000);

      // Store cleanup for disconnect handling
      (controller as unknown as Record<string, () => void>)._cleanup = () => {
        clearInterval(heartbeat);
        unregister();
      };
    },
    cancel(controller) {
      const ctrl = controller as unknown as Record<string, (() => void) | undefined>;
      ctrl._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
