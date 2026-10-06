/** Generate the public declarations from canonical schema fragments, offline. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas')
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'generated')
mkdirSync(OUT, { recursive: true })
const files = ['hitl-object', 'poll-response', 'form-field', 'submit-request', 'discovery-response', 'verification-policy', 'verification-result', 'submission-context']

for (const version of ['0.8', '0.9']) {
  const directory = version === '0.8' ? join(ROOT, 'v0.8') : ROOT
  const schemas = Object.fromEntries(files.map((name) => [name, JSON.parse(readFileSync(join(directory, `${name}.schema.json`), 'utf8'))]))
  const hitl = schemas['hitl-object']
  const poll = schemas['poll-response']
  const pollProperties = poll.properties ?? poll.$defs.pollBase.properties
  const form = hitl.properties.context.properties.form
  const formProperties = form.properties ?? Object.fromEntries(form.oneOf.flatMap((branch) => Object.entries(branch.properties).filter(([, value]) => value !== false)))
  const field = schemas['form-field']
  const policy = schemas['verification-policy']
  const requirement = policy.$defs.evidenceRequirement
  const submit = schemas['submit-request']
  const discovery = schemas['discovery-response']
  const discoveryProperties = discovery.properties.hitl_protocol.properties
  const context = schemas['submission-context']
  const contextProperties = context.properties ?? context.oneOf[0].properties
  const definitions = {
    HitlObject: hitl, PollResponse: poll, FormField: field, SubmitRequest: submit,
    DiscoveryResponse: discovery, VerificationPolicy: policy,
    VerificationResult: schemas['verification-result'], SubmissionContext: context,
    ReviewType: hitl.properties.type.anyOf[0], CustomReviewType: hitl.properties.type.anyOf[1], AnyReviewType: hitl.properties.type,
    ReviewStatus: pollProperties.status, DefaultAction: hitl.properties.default_action,
    ProofType: requirement.properties.proof_type, AssuranceLevel: requirement.properties.min_assurance,
    VerificationMode: policy.properties.mode, VerificationPath: policy.properties.required_for.items,
    SubmissionMode: contextProperties.mode.const ? { type: 'string', enum: context.oneOf.map((branch) => branch.properties.mode.const) } : contextProperties.mode,
    EvidenceFormat: requirement.properties.presentation_formats.items,
    HitlContext: hitl.properties.context, Surface: hitl.properties.surface,
    VerificationRequirement: requirement, VerificationRequirementBranch: policy.properties.requirements.properties.any_of.items,
    VerificationPolicyRequirements: policy.properties.requirements, VerificationBinding: policy.properties.binding, VerificationFallback: policy.properties.fallback,
    DiscoveryServiceInfo: discoveryProperties.service, DiscoveryCapabilities: discoveryProperties.capabilities,
    DiscoveryEndpoints: discoveryProperties.endpoints, DiscoveryAuthentication: discoveryProperties.authentication,
    DiscoveryRateLimits: discoveryProperties.rate_limits, DiscoveryPolicies: discoveryProperties.policies, DiscoveryExamples: discoveryProperties.examples,
    ReviewResult: pollProperties.result, ResultSignature: pollProperties.result.properties.signature,
    RespondedBy: pollProperties.responded_by, ReviewProgress: pollProperties.progress,
    VerificationEvidence: submit.$defs.verificationEvidence,
    VerifiedEvidence: schemas['verification-result'].properties.verified_evidence.items,
    FormDefinition: form, FormStep: formProperties.steps.items,
    FormFieldOption: field.properties.options.items, FormFieldValidation: field.properties.validation,
    FormFieldConditional: field.properties.conditional,
    FieldType: field.properties.type.anyOf?.[0] ?? { type: 'string', enum: field.properties.type.examples },
    ConditionalOperator: field.properties.conditional.properties.operator,
    SubmittedBy: submit.properties.submitted_by,
    SubmissionChannel: submit.properties.submitted_via.anyOf[0], SubmissionPlatform: submit.properties.submitted_by.properties.platform.anyOf[0],
  }
  const names = new Map(Object.entries(definitions).map(([name, schema]) => [schema, name]))
  const owners = new Map()
  function register(node, owner) {
    if (!node || typeof node !== 'object') return
    owners.set(node, owner)
    for (const value of Object.values(node)) register(value, owner)
  }
  for (const schema of Object.values(schemas)) register(schema, schema)
  function resolve(ref, owner) {
    const [path, fragment] = ref.split('#')
    const target = path ? schemas[path.split('/').at(-1).replace(/(?:\.schema)?\.json$/, '')] : owner
    if (!target) throw new Error(`Unresolved offline schema reference: ${ref}`)
    return fragment ? fragment.slice(1).split('/').reduce((node, key) => node[key.replace(/~1/g, '/').replace(/~0/g, '~')], target) : target
  }
  function transform(node, top) {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((item) => transform(item, top))
    const name = names.get(node)
    if (name && name !== top) return { $ref: `#/$defs/${name}` }
    if (node.$ref) {
      const target = resolve(node.$ref, owners.get(node))
      return { ...transform(target, top), ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref').map(([key, value]) => [key, transform(value, top)])) }
    }
    const transformed = Object.fromEntries(Object.entries(node).filter(([key]) => !['$schema', '$id', '$defs'].includes(key)).map(([key, value]) => {
      if (['properties', 'patternProperties'].includes(key)) return [key, Object.fromEntries(Object.entries(value).map(([property, schema]) => [property, transform(schema, top)]))]
      if (['default', 'examples', 'enum', 'const'].includes(key)) return [key, value]
      return [key, transform(value, top)]
    }))
    if (node.pattern === '^x-') transformed.tsType = '`x-${string}`'
    if (!node.type && !node.anyOf && !node.oneOf && !node.allOf && !node.enum && !node.pattern && !('const' in node) && !node.properties) transformed.tsType = 'unknown'
    return transformed
  }
  const catalog = { title: 'ProtocolTypeCatalog', type: 'object', additionalProperties: false,
    $defs: Object.fromEntries(Object.entries(definitions).map(([name, schema]) => [name, { ...transform(schema, name), title: name }])) }
  const generated = await compile(catalog, 'ProtocolTypeCatalog', {
    unreachableDefinitions: true, unknownAny: true, format: true,
    bannerComment: `/** Generated from canonical HITL v${version} JSON Schemas. Do not edit. */`,
    style: { singleQuote: true, semi: false, tabWidth: 2 },
  })
  writeFileSync(join(OUT, `v${version}.ts`), generated)
}
