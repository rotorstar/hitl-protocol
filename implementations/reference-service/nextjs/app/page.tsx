export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: '600px', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>HITL Reference Service</h1>
      <p>HITL Protocol v0.6 reference implementation (Next.js App Router).</p>
      <h2>Try it</h2>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`curl -X POST http://localhost:3459/api/demo?type=selection
curl -X POST http://localhost:3459/api/demo?type=approval
curl -X POST http://localhost:3459/api/demo?type=input
curl -X POST http://localhost:3459/api/demo?type=confirmation
curl -X POST http://localhost:3459/api/demo?type=escalation`}
      </pre>
      <p>
        <a href="https://github.com/rotorstar/hitl-protocol">HITL Protocol Spec</a>
      </p>
    </main>
  );
}
