const url = 'http://localhost:8189/realms/hitl/.well-known/openid-configuration'
const deadline = Date.now() + 120_000
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (response.ok) {
      const metadata = await response.json()
      if (metadata.issuer === 'http://localhost:8189/realms/hitl') process.exit(0)
    }
  } catch { /* Only the readiness probe retries. Evals never suppress a failure. */ }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
throw new Error('The actual eval Keycloak provider did not become ready')
