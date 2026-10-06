# HITL Protocol JSON Schemas

This directory is the canonical **v0.9** JSON Schema Draft 2020-12 source. The published `@hitl-protocol/schemas` package copies these files, derives TypeScript types, and compiles runtime validators.

The complete **v0.8** reference closure and OpenAPI document are archived unchanged in [v0.8](v0.8/), with a SHA-256 manifest. Do not modify historical contracts. Aliases ending in `.json` preserve their original reference names; package generation provides equivalent local aliases for v0.9.

| Schema | Direction / use |
|---|---|
| [hitl-object.schema.json](hitl-object.schema.json) | Service → agent HTTP 202 `hitl` object |
| [poll-response.schema.json](poll-response.schema.json) | Service → agent decision status |
| [submit-request.schema.json](submit-request.schema.json) | Agent → service inline submission |
| [discovery-response.schema.json](discovery-response.schema.json) | Public `/.well-known/hitl.json` |
| [form-field.schema.json](form-field.schema.json) | Input review field definitions |
| [verification-policy.schema.json](verification-policy.schema.json) | Verification policy |
| [verification-result.schema.json](verification-result.schema.json) | Normalized provider-independent outcome |
| [submission-context.schema.json](submission-context.schema.json) | Browser/inline submission origin |

## Use the matching contract

```typescript
import { validateHitlObject, validatePollResponse } from '@hitl-protocol/schemas/v0.9'
import * as historical from '@hitl-protocol/schemas/v0.8'

if (!validateHitlObject(response.hitl)) {
  console.error(validateHitlObject.errors)
}
if (!validatePollResponse(poll)) {
  console.error(validatePollResponse.errors)
}
```

Unversioned package imports select v0.9. Supported-version validators dispatch HITL and discovery only; choose poll and submit contracts from the initiating HITL version. Register all referenced resources with their canonical `$id` in other validators; an offline consumer can resolve the local aliases included in the package. See [package documentation](../packages/schemas/README.md) for raw JSON imports, generated types, and verification commands.

v0.9 terminal poll fields and submission/form alternatives are represented as disjoint schema branches. Runtime validation remains authoritative for constraints that TypeScript cannot represent. Business policy, credential validation, reviewer authorization, and execution remain service responsibilities.

The [core OpenAPI document](openapi.yaml) describes the generic transport; the optional [Agent Access profile](../profiles/agent-access/v0.1/README.md) provides a concrete protected API contract. That profile's domain schemas are generated from its runtime Zod source rather than maintained here.
