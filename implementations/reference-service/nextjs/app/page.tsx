export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: '600px', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>HITL Reference Service</h1>
      <p>HITL Protocol v0.7 reference implementation (Next.js App Router).</p>
      <p>
        This demo implements the HITL core flow with browser fallback and inline submit support.
        Declarative surface interop remains profile-defined and is not emitted by this reference service.
      </p>
      <h2>Try it</h2>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`curl -X POST http://localhost:3459/api/demo?type=selection
curl -X POST http://localhost:3459/api/demo?type=approval
curl -X POST http://localhost:3459/api/demo?type=input
curl -X POST http://localhost:3459/api/demo?type=confirmation
curl -X POST http://localhost:3459/api/demo?type=escalation
curl http://localhost:3459/.well-known/hitl.json`}
      </pre>
      <p>
        <a href="https://github.com/rotorstar/hitl-protocol">HITL Protocol Spec</a>
      </p>
    </main>
  );
}
