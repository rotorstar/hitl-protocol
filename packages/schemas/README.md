# @hitl-protocol/schemas

JSON Schema Draft 2020-12 contracts, generated TypeScript types, and AJV validators for HITL Protocol.

## Versions and imports

The package default is **v0.9**. Historical consumers must select **v0.8** explicitly; installing package 0.9 changes the contract of an unversioned import.

```typescript
import { validateHitlObject, validatePollResponse } from '@hitl-protocol/schemas'
import type { HitlObject, PollResponse } from '@hitl-protocol/schemas'
import * as v08 from '@hitl-protocol/schemas/v0.8'
import * as v09 from '@hitl-protocol/schemas/v0.9'
```

Both version entrypoints expose their own types, all eight raw schema objects, and typed validators. Version validators reject another advertised version. Poll and submit payloads contain no version discriminator: select their validator from the initiating HITL object's contract. Never guess their version from optional fields.

```typescript
import {
  validateSupportedHitlObject,
  validateSupportedDiscoveryResponse,
} from '@hitl-protocol/schemas'

if (validateSupportedHitlObject(payload)) {
  // payload is SupportedHitlObject (v0.8 | v0.9), not exclusively v0.9.
  if (payload.spec_version === '0.9') {
    console.log(payload.case_id)
  }
} else {
  console.error(validateSupportedHitlObject.errors)
}
```

Supported-version dispatch exists only for HITL and discovery, which advertise a version. All validators accept unknown input, return a boolean type guard, and expose AJV errors through `.errors` (null after a successful call).

## Raw schemas

```typescript
import { hitlObjectSchema, submissionContextSchema } from '@hitl-protocol/schemas/v0.9'
import historicalSchema from '@hitl-protocol/schemas/v0.8/hitl-object.schema.json' with { type: 'json' }
import currentSchema from '@hitl-protocol/schemas/hitl-object.schema.json' with { type: 'json' }
```

Individual JSON exports are available at the package root (v0.9), `/v0.8/`, and `/v0.9/`. Each includes the complete local reference closure for offline validation. Schemas are copied into the package from the repository's canonical `schemas/` sources; do not edit package copies.

| Contract | Main consumer |
|---|---|
| `hitl-object.schema.json` | Service → agent HTTP 202 |
| `poll-response.schema.json` | Service → agent decision status |
| `submit-request.schema.json` | Agent → service inline submission |
| `discovery-response.schema.json` | Public `/.well-known/hitl.json` |
| `form-field.schema.json` | Input review fields |
| `verification-policy.schema.json` | Required verification paths |
| `verification-result.schema.json` | Normalized verification outcome |
| `submission-context.schema.json` | Completed submission origin |

## Type and runtime guarantees

Types are generated from canonical schemas with json-schema-to-typescript. v0.9 uses disjoint terminal poll, browser/inline context, and single/multiple step form branches; completed polls require a result and completion timestamp. Known `x-` extension patterns become template literal types.

TypeScript cannot enforce every runtime condition, including timestamps, numeric bounds, regex patterns, conditional action/value requirements, and business authorization. Always run the corresponding validator at a trust boundary. Schema validation does not prove human presence or authorize execution.

## Development and verification

Use the repository's Node 24 and pnpm toolchain.

- `pnpm generate`: copy canonical schemas and regenerate both versions' public types.
- `pnpm build`: emit JavaScript with tsup and declarations with the TypeScript compiler.
- `pnpm typecheck`: check implementation and positive/negative consumer fixtures.
- `pnpm test`: validate legacy/current contracts, archive checksums, and profile conformance.
- `pnpm test:pack`: verify built npm exports, declarations, and raw schema closure offline.
- `pnpm generate:profile` / `pnpm check:profile`: project canonical agent-access Zod contracts into profile artifacts and detect drift.

The immutable archive manifest checks all v0.8 schema bytes. Profile generation additionally requires the workspace's `packages/agent-access` dependencies; it is a repository development task, not a dependency of the published schema package.

Apache-2.0.
