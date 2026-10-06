import { z } from 'zod'
import canonicalize from 'canonicalize'
import { createHash } from 'node:crypto'

export const PROFILE_ID = 'hitl-agent-access/0.1' as const
export const PUBLIC_WEB_PROFILE_ID = 'hitl-agent-access-public-web/0.1' as const
export const DELEGATED_API_PROFILE_ID = 'hitl-agent-access-delegated-api/0.1' as const
export const PUBLIC_WEB_DRAFT = 'draft-ietf-webbotauth-httpsig-protocol-00' as const
export const POLICY_VERSION = 1
export const REVIEW_THRESHOLD_CENTS = 10_000
export const HARD_LIMIT_CENTS = 50_000

const IdentifierSchema = z.string().min(1).max(256)
const ResourceIdentifierSchema = IdentifierSchema.regex(/^[A-Za-z0-9_-]+$/)
const PositiveIntegerSchema = z.int().positive()
const CentsSchema = z.int().nonnegative()

export const PrepareInputSchema = z.strictObject({
  grant_id: ResourceIdentifierSchema,
  offer_id: ResourceIdentifierSchema,
  offer_version: PositiveIntegerSchema,
  quantity: PositiveIntegerSchema,
})
export type PrepareInput = z.infer<typeof PrepareInputSchema>
export const EnrollmentInputSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(100).optional(),
  max_total_cents: z.int().min(1).max(HARD_LIMIT_CENTS).default(HARD_LIMIT_CENTS),
})
export type EnrollmentInput = z.infer<typeof EnrollmentInputSchema>
export const CommitInputSchema = z.strictObject({
  expected_version: PositiveIntegerSchema,
  snapshot_digest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type CommitInput = z.infer<typeof CommitInputSchema>
export const OfferSnapshotSchema = z.strictObject({
  offer_id: ResourceIdentifierSchema,
  offer_version: PositiveIntegerSchema,
  title: z.string().min(1).max(500),
  unit_price_cents: CentsSchema,
  fee_cents: CentsSchema,
  quantity: PositiveIntegerSchema,
  total_cents: CentsSchema,
  currency: z.literal('EUR'),
  refundable: z.boolean(),
  terms: z.string().min(1).max(10_000),
  policy_version: PositiveIntegerSchema,
  grant_version: PositiveIntegerSchema,
}).refine((value) => Number.isSafeInteger(value.unit_price_cents * value.quantity + value.fee_cents)
  && value.total_cents === value.unit_price_cents * value.quantity + value.fee_cents,
{ message: 'Total must equal unit_price_cents * quantity + fee_cents', path: ['total_cents'] })
export type OfferSnapshot = z.infer<typeof OfferSnapshotSchema>
export const AgentFactsSchema = z.strictObject({
  iss: z.url(), sub: IdentifierSchema, client_id: IdentifierSchema,
  jkt: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  scopes: z.array(z.string().min(1).max(128)).max(100),
  exp: PositiveIntegerSchema, observed_at: z.iso.datetime(),
})
export type AgentFacts = z.infer<typeof AgentFactsSchema>
export const BrowserIdentitySchema = z.strictObject({
  iss: z.url(), sub: IdentifierSchema, auth_time: z.int().nonnegative(),
  display_name: z.string().max(200).optional(), verified_email: z.email().optional(),
})
export type BrowserIdentity = z.infer<typeof BrowserIdentitySchema>
export const CatalogOfferSchema = z.strictObject({
  id: ResourceIdentifierSchema, version: PositiveIntegerSchema, title: z.string().min(1).max(500),
  unit_price_cents: CentsSchema, fee_cents: CentsSchema, currency: z.literal('EUR'),
  refundable: z.boolean(), terms: z.string().min(1).max(10_000), stock: z.int().nonnegative(),
})
export type CatalogOffer = z.infer<typeof CatalogOfferSchema>
export const CatalogResponseSchema = z.strictObject({
  offers: z.array(CatalogOfferSchema),
  agent: z.strictObject({ status: z.enum(['anonymous', 'verified']), identifier: z.url().optional(),
    keyid: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), observed_at: z.iso.datetime().optional() }),
})
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>
export const OperationStatusSchema = z.enum(['awaiting_approval', 'ready', 'succeeded', 'cancelled', 'expired', 'superseded', 'failed'])
export type OperationStatus = z.infer<typeof OperationStatusSchema>
export const ReviewActionSchema = z.enum(['confirm', 'cancel'])
export type ReviewAction = z.infer<typeof ReviewActionSchema>
export const BookingResultSchema = z.strictObject({
  booking_id: ResourceIdentifierSchema, offer_id: ResourceIdentifierSchema, quantity: PositiveIntegerSchema,
  total_cents: CentsSchema, currency: z.literal('EUR'),
})
export type BookingResult = z.infer<typeof BookingResultSchema>
export const OperationResponseSchema = z.strictObject({
  operation_id: ResourceIdentifierSchema, operation_version: PositiveIntegerSchema,
  snapshot_digest: z.string().regex(/^[a-f0-9]{64}$/), status: OperationStatusSchema,
  created_at: z.iso.datetime(), expires_at: z.iso.datetime(), snapshot: OfferSnapshotSchema,
  review_case_id: ResourceIdentifierSchema.optional(),
  result: z.union([BookingResultSchema, z.strictObject({ error: z.string().min(1) })]).optional(),
})
export type OperationResponse = z.infer<typeof OperationResponseSchema>
export const EnrollmentResponseSchema = z.strictObject({
  id: ResourceIdentifierSchema, verification_url: z.url(), expires_at: z.iso.datetime(),
  status: z.enum(['pending', 'confirmed', 'expired']),
  principal_id: ResourceIdentifierSchema.optional(), grant_id: ResourceIdentifierSchema.optional(),
})
export type EnrollmentResponse = z.infer<typeof EnrollmentResponseSchema>
export const AgentAccessContextSchema = z.strictObject({
  profile: z.literal(PROFILE_ID), binding: z.literal('delegated-api'),
  operation_id: ResourceIdentifierSchema, operation_version: PositiveIntegerSchema,
  snapshot_digest: z.string().regex(/^[a-f0-9]{64}$/),
  execution_mode: z.literal('explicit_commit'),
})
export type AgentAccessContext = z.infer<typeof AgentAccessContextSchema>
export const GrantPolicySchema = z.strictObject({ max_total_cents: z.int().min(1).max(HARD_LIMIT_CENTS) })
export type GrantPolicy = z.infer<typeof GrantPolicySchema>
export type PolicyDecision = 'allow' | 'review' | 'deny'

/** The policy never treats a human confirmation as authority to exceed the grant. */
export function evaluatePolicy(snapshot: OfferSnapshot, grant: GrantPolicy): PolicyDecision {
  const validated = OfferSnapshotSchema.parse(snapshot)
  const limits = GrantPolicySchema.parse(grant)
  if (validated.total_cents > Math.min(HARD_LIMIT_CENTS, limits.max_total_cents)) return 'deny'
  return validated.total_cents <= REVIEW_THRESHOLD_CENTS && validated.refundable ? 'allow' : 'review'
}
export function canonicalDigest(value: unknown): string {
  const json = canonicalize(value)
  if (typeof json !== 'string') throw new TypeError('Value cannot be represented as canonical JSON')
  return createHash('sha256').update(json).digest('hex')
}
export function snapshotDigest(snapshot: OfferSnapshot): string { return canonicalDigest(OfferSnapshotSchema.parse(snapshot)) }
export function prepareFingerprint(input: PrepareInput): string { return canonicalDigest(PrepareInputSchema.parse(input)) }

export function agentAccessDiscovery(baseUrl: string, issuer: string) {
  return {
    hitl_protocol: {
      spec_version: '0.9', service: { name: 'HITL Agent Access Reference', url: baseUrl },
      capabilities: { review_types: ['confirmation'], transports: ['polling'], supports_inline_submit: false, supports_agent_binding: true },
      authentication: { type: 'oauth2', profiles: [PROFILE_ID, PUBLIC_WEB_PROFILE_ID, DELEGATED_API_PROFILE_ID], well_known: `${baseUrl}/.well-known/oauth-protected-resource`, documentation: `${baseUrl}/docs/agent-access` },
      examples: { openapi: `${baseUrl}/openapi.json` },
    },
  }
}
export function protectedResourceMetadata(baseUrl: string, issuer: string) {
  return { resource: baseUrl, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: ['hitl:agent:enroll', 'hitl:reviews:read', 'bookings:read', 'bookings:prepare', 'bookings:commit'], dpop_signing_alg_values_supported: ['ES256'], dpop_bound_access_tokens_required: true }
}
/** OpenAPI/profile JSON Schema is derived from the same canonical runtime schemas. */
export const AGENT_ACCESS_JSON_SCHEMAS = {
  PrepareInput: z.toJSONSchema(PrepareInputSchema, { io: 'input' }), EnrollmentInput: z.toJSONSchema(EnrollmentInputSchema, { io: 'input' }),
  CommitInput: z.toJSONSchema(CommitInputSchema, { io: 'input' }), OfferSnapshot: z.toJSONSchema(OfferSnapshotSchema),
  AgentFacts: z.toJSONSchema(AgentFactsSchema), BrowserIdentity: z.toJSONSchema(BrowserIdentitySchema),
  AgentAccessContext: z.toJSONSchema(AgentAccessContextSchema), OperationResponse: z.toJSONSchema(OperationResponseSchema),
  EnrollmentResponse: z.toJSONSchema(EnrollmentResponseSchema), BookingResult: z.toJSONSchema(BookingResultSchema),
  CatalogOffer: z.toJSONSchema(CatalogOfferSchema), CatalogResponse: z.toJSONSchema(CatalogResponseSchema),
  OperationStatus: z.toJSONSchema(OperationStatusSchema), ReviewAction: z.toJSONSchema(ReviewActionSchema),
} as const
