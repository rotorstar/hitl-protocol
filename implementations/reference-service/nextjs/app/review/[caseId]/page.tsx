import { getCase, verifyTokenForPurpose, transition, getBaseUrl } from '@/lib/hitl';
import { notFound } from 'next/navigation';

const TEMPLATE_MAP: Record<string, string> = {
  selection: 'selection.html',
  approval: 'approval.html',
  input: 'input.html',
  confirmation: 'confirmation.html',
  escalation: 'escalation.html',
};

export default async function ReviewPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ caseId }, { token }] = await Promise.all([params, searchParams]);
  const rc = getCase(caseId);

  if (!rc) notFound();
  if (!token || !verifyTokenForPurpose(token, rc, 'review')) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: '2rem', textAlign: 'center' }}>
        <h1>Invalid Token</h1>
        <p>The review link is invalid or has expired.</p>
      </main>
    );
  }

  // Mark as opened
  if (rc.status === 'pending') {
    try { transition(rc, 'opened'); } catch {}
  }

  const base = getBaseUrl();
  const hitlData = {
    case_id: rc.case_id,
    prompt: rc.prompt,
    type: rc.type,
    status: rc.status,
    token,
    respond_url: `${base}/reviews/${rc.case_id}/respond`,
    expires_at: rc.expires_at,
    context: rc.context,
  };

  // Read and inject template (same templates as Express/Hono/FastAPI)
  const [fs, path] = await Promise.all([import('node:fs'), import('node:path')]);
  const templatesDir = path.join(process.cwd(), '..', '..', '..', 'templates');
  const templateFile = TEMPLATE_MAP[rc.type];

  let html: string;
  try {
    html = fs.readFileSync(path.join(templatesDir, templateFile), 'utf-8');
  } catch {
    return (
      <main style={{ fontFamily: 'system-ui', padding: '2rem', textAlign: 'center' }}>
        <h1>Template Error</h1>
        <p>Review page template not found. Ensure templates/ directory exists.</p>
      </main>
    );
  }

  const safePrompt = rc.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html
    .replace(/\{\{prompt\}\}/g, safePrompt)
    .replace('{{hitl_data_json}}', JSON.stringify(hitlData));

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
