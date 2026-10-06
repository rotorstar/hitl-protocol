/** Project canonical domain Zod contracts into the public profile/OpenAPI artifacts. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_ACCESS_JSON_SCHEMAS, PROFILE_ID, PUBLIC_WEB_PROFILE_ID, DELEGATED_API_PROFILE_ID } from '../../agent-access/src/contracts.ts'

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'profiles', 'agent-access', 'v0.1')
const coreDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas')
const coreNames = { 'hitl-object': 'HitlObject', 'poll-response': 'PollResponse', 'form-field': 'FormField', 'submit-request': 'SubmitRequest', 'discovery-response': 'DiscoveryResponse', 'verification-policy': 'VerificationPolicy', 'verification-result': 'VerificationResult', 'submission-context': 'SubmissionContext' }
function inlineCore(node, owner) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((value) => inlineCore(value, owner))
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$id').map(([key, value]) => {
    if (key !== '$ref') return [key, inlineCore(value, owner)]
    if (value.startsWith('#/')) return [key, `#/components/schemas/${owner}${value.slice(1)}`]
    const [path, fragment] = value.split('#')
    const name = coreNames[path.replace(/(?:\.schema)?\.json$/, '')]
    if (!name) throw new Error(`Unresolved OpenAPI core reference: ${value}`)
    return [key, `#/components/schemas/${name}${fragment ? fragment : ''}`]
  }))
}
const coreSchemas = Object.fromEntries(Object.entries(coreNames).map(([file, name]) => [name, inlineCore(JSON.parse(readFileSync(join(coreDirectory, `${file}.schema.json`), 'utf8')), name)]))
mkdirSync(directory, { recursive: true })
const artifact = (file, value) => {
  const serialized = JSON.stringify(value, null, 2) + '\n'
  const path = join(directory, file)
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== serialized) throw new Error(`Generated profile artifact drift: ${file}`)
  } else writeFileSync(path, serialized)
}
artifact('agent-access-context.schema.json', {
  ...AGENT_ACCESS_JSON_SCHEMAS.AgentAccessContext,
  $id: 'https://hitl-protocol.org/profiles/agent-access/v0.1/agent-access-context.json',
})

const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema) => ({ 'application/json': { schema } })
const response = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) })
const dpop = [{ DPoPAccessToken: [], DPoPProof: [] }]
const browser = [{ BrowserSession: [] }]
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }
const ifNoneMatch = { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' }, description: 'Reuse a prior ETag; authentication and authorization still apply before any 304 response.' }
const etag = { ETag: { description: 'Digest of the authorized current response', schema: { type: 'string' } } }
const body = (schema) => ({ required: true, content: json(schema) })
const formBody = (schema) => ({ required: true, content: { 'application/x-www-form-urlencoded': { schema } } })
const errors = Object.fromEntries([400, 401, 403, 404, 409, 410, 429, 503].map((code) => [String(code), {
  ...response({ 400: 'Invalid request', 401: 'Missing, invalid, or replayed credentials/proof; nonce challenges include DPoP-Nonce and WWW-Authenticate', 403: 'Insufficient scope or grant/policy limit', 404: 'Object missing or not owned by the authenticated caller', 409: 'Idempotency, operation version/state, or stock conflict', 410: 'Enrollment, review, or operation expired', 429: 'Rate limited; Retry-After indicates delay', 503: 'Required authorization server or persistence unavailable; retry safely' }[code], ref('Error')),
  ...(code === 401 ? { headers: { 'WWW-Authenticate': { schema: { type: 'string' } }, 'DPoP-Nonce': { schema: { type: 'string' } } } } : {}),
  ...(code === 429 ? { headers: { 'Retry-After': { schema: { type: 'string' } } } } : {}),
}]))
const operation = (operationId, binding, options) => ({
  operationId, 'x-hitl-agent-access-binding': binding,
  security: binding === 'delegated-api' ? dpop : browser,
  ...options,
})
const html = (description) => ({ description, content: { 'text/html': { schema: { type: 'string' } } } })
const csrf = { type: 'object', required: ['csrf'], properties: { csrf: { type: 'string', minLength: 1 } }, additionalProperties: false }
const browserErrors = Object.fromEntries(Object.entries(errors).map(([code, entry]) => [code, html(entry.description)]))
const browserResponses = { 200: html('Service-hosted accessible browser view'), 303: response('Token-free URL or login/confirmation redirect; Location header'), ...browserErrors }
const document = {
  openapi: '3.2.1',
  info: { title: 'HITL Agent Access Reference API', version: '0.1', description: `Optional ${PROFILE_ID}; bindings ${PUBLIC_WEB_PROFILE_ID} and ${DELEGATED_API_PROFILE_ID}. DPoP token/proof requirements are conjunctive. Browser sessions are independent reviewer identities. The context does not authorize execution.` },
  servers: [{ url: '/', description: 'Configured service public origin' }],
  paths: {
    '/.well-known/hitl.json': { get: { operationId: 'discoverHitl', security: [], responses: { 200: response('Implemented HITL profiles', ref('DiscoveryResponse')) } } },
    '/.well-known/oauth-protected-resource': { get: { operationId: 'discoverProtectedResource', security: [], responses: { 200: response('RFC 9728 metadata, including the supported authorization server and scopes', { type: 'object', additionalProperties: true }) } } },
    '/v1/catalog': { get: { operationId: 'getCatalog', 'x-hitl-agent-access-binding': 'public-web', security: [{}, { HttpMessageSignature: [], HttpMessageSignatureInput: [], SignatureAgent: [] }], description: 'Public catalog. Anonymous and valid signed requests receive separate quotas. Presenting an invalid signature fails validation; it does not downgrade to anonymous.', responses: { 200: response('Available public offers; an empty offers list is valid', ref('CatalogResponse')), ...errors } } },
    '/v1/agent-enrollments': { post: operation('proposeAgentEnrollment', 'delegated-api', { 'x-required-scopes': ['hitl:agent:enroll'], requestBody: body(ref('EnrollmentInput')), responses: { 201: response('Pending owner confirmation', ref('EnrollmentResponse')), ...errors } }) },
    '/v1/agent-enrollments/{id}': { get: operation('getAgentEnrollment', 'delegated-api', { parameters: [id], 'x-required-scopes': ['hitl:agent:enroll'], description: 'Restricted to original issuer/subject/client/key facts.', responses: { 200: response('Persisted enrollment status', ref('EnrollmentResponse')), ...errors } }) },
    '/v1/bookings/prepare': { post: operation('prepareBooking', 'delegated-api', {
      'x-required-scopes': ['bookings:prepare'], parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }, description: 'Scoped to principal and request fingerprint; reusing with another body is a conflict.' }],
      requestBody: body(ref('PrepareInput')), responses: { 200: response('Ready operation; no booking has executed', ref('OperationResponse')), 202: response('Immutable snapshot needs the authorized human owner decision', ref('HumanInputRequired')), ...errors },
    }) },
    '/v1/reviews/{id}': { get: operation('getBoundReview', 'delegated-api', { parameters: [id, ifNoneMatch], 'x-required-scopes': ['hitl:reviews:read'], responses: { 200: { ...response('HITL v0.9 decision state; completed is not execution', ref('PollResponse')), headers: etag }, 304: { ...response('Authorized state unchanged; no response body'), headers: etag }, ...errors } }) },
    '/v1/operations/{id}': { get: operation('getBoundOperation', 'delegated-api', { parameters: [id, ifNoneMatch], 'x-required-scopes': ['bookings:read'], responses: { 200: { ...response('Persisted operation/result restricted to initiating principal', ref('OperationResponse')), headers: etag }, 304: { ...response('Authorized state unchanged; no response body'), headers: etag }, ...errors } }) },
    '/v1/operations/{id}/commit': { post: operation('commitBooking', 'delegated-api', { parameters: [id], 'x-required-scopes': ['bookings:commit'], requestBody: body(ref('CommitInput')), description: 'Fresh authorization plus current local grant and exact snapshot/version required. Successful retries return the same persisted booking; completion of a review alone never executes.', responses: { 200: response('Persisted successful local booking', ref('OperationResponse')), ...errors } }) },
    '/connect/{id}': {
      get: operation('showEnrollmentConfirmation', 'browser', { parameters: [id], responses: browserResponses }),
      post: operation('confirmAgentEnrollment', 'browser', { parameters: [id], requestBody: formBody(csrf), responses: { 303: response('Enrollment confirmed; browser redirect'), ...browserErrors } }),
    },
    '/review/{id}': { get: operation('showBoundReview', 'browser', { parameters: [id, { name: 'token', in: 'query', required: false, schema: { type: 'string' }, description: 'Initial case-access token only. Exchanged for a case-scoped session then redirected to the same token-free URL; independent authenticated owner checks remain mandatory.' }], responses: browserResponses }) },
    '/review/{id}/respond': { post: operation('respondToBoundReview', 'browser', { parameters: [id], requestBody: formBody({ ...csrf, required: ['action', 'csrf'], properties: { ...csrf.properties, action: ref('ReviewAction') } }), responses: { 303: response('Immutable decision recorded; browser redirect'), ...browserErrors } }) },
    '/account/agents': { get: operation('listConnectedAgents', 'browser', { responses: browserResponses }) },
    '/account/agents/{id}/revoke': { post: operation('revokeConnectedAgent', 'browser', { parameters: [id], requestBody: formBody(csrf), description: 'Idempotent local revocation; owner identity and CSRF required.', responses: { 303: response('Grant revoked; browser redirect'), ...browserErrors } }) },
  },
  components: {
    securitySchemes: {
      DPoPAccessToken: { type: 'http', scheme: 'DPoP', bearerFormat: 'JWT', description: 'DPoP-bound access token; a Bearer token is rejected.' },
      DPoPProof: { type: 'apiKey', in: 'header', name: 'DPoP', description: 'RFC 9449 request proof including method, URI, token hash, replay protection, and server nonce.' },
      HttpMessageSignature: { type: 'apiKey', in: 'header', name: 'Signature', description: 'RFC 9421 plus pinned Web Bot Auth WG draft 00. Requires Signature-Input and dictionary Signature-Agent; signed method and target are mandatory.' },
      HttpMessageSignatureInput: { type: 'apiKey', in: 'header', name: 'Signature-Input', description: 'RFC 9421 covered components and signature parameters, correlated by dictionary key.' },
      SignatureAgent: { type: 'apiKey', in: 'header', name: 'Signature-Agent', description: 'Web Bot Auth WG draft 00 dictionary identifies the signing entity for each signature label.' },
      BrowserSession: { type: 'apiKey', in: 'cookie', name: '__Host-hitl-session', description: 'Independently authenticated owner session; loopback development uses hitl-session. Review rendering/submission additionally requires a case-scoped capability. Browser mutations require matching HttpOnly __Host-hitl-csrf (development hitl-csrf), hidden csrf body value, persisted hash, and trusted Origin.' },
    },
    schemas: {
      ...coreSchemas,
      ...AGENT_ACCESS_JSON_SCHEMAS,
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string', enum: ['invalid_request', 'invalid_token', 'invalid_dpop_proof', 'use_dpop_nonce', 'insufficient_scope', 'limit_exceeded', 'not_found', 'idempotency_conflict', 'version_conflict', 'state_conflict', 'out_of_stock', 'expired', 'rate_limited', 'temporarily_unavailable'] }, message: { type: 'string' } }, additionalProperties: true },
      HumanInputRequired: { type: 'object', required: ['status', 'hitl'], properties: { status: { const: 'human_input_required' }, hitl: ref('HitlObject') }, additionalProperties: true },
    },
  },
}
artifact('openapi.json', document)
