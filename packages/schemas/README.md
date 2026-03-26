# @hitl-protocol/schemas

JSON Schemas, TypeScript types, and validators for [HITL Protocol](https://github.com/rotorstar/hitl-protocol) v0.8.

## Install

```bash
npm install @hitl-protocol/schemas
```

## Usage

### TypeScript Types

```typescript
import type {
  HitlObject,
  PollResponse,
  SubmitRequest,
  VerificationPolicy,
} from '@hitl-protocol/schemas'

function handleResponse(hitl: HitlObject) {
  console.log(hitl.case_id, hitl.review_url)

  if (hitl.verification_policy?.required_for.includes('inline_submit')) {
    console.log('Inline submit requires proof preflight')
  }
}

const policy: VerificationPolicy = {
  mode: 'required',
  required_for: ['inline_submit'],
  requirements: {
    any_of: [{ all_of: [{ proof_type: 'proof_of_human', provider: 'world_id' }] }],
  },
  binding: {
    case_id: true,
    action: true,
    freshness_seconds: 300,
    single_use: true,
  },
  fallback: {
    on_missing: 'browser_review',
    on_invalid: 'browser_review',
  },
}
```

### Validation

```typescript
import {
  validateHitlObject,
  validatePollResponse,
  validateSubmitRequest,
  validateVerificationPolicy,
} from '@hitl-protocol/schemas'

if (!validateHitlObject(data)) {
  console.error(validateHitlObject.errors)
}

if (!validatePollResponse(poll)) {
  console.error(validatePollResponse.errors)
}

if (!validateSubmitRequest(submit)) {
  console.error(validateSubmitRequest.errors)
}

if (!validateVerificationPolicy(policy)) {
  console.error(validateVerificationPolicy.errors)
}
```

### Raw JSON Schemas

```typescript
import {
  hitlObjectSchema,
  verificationPolicySchema,
  submissionContextSchema,
} from '@hitl-protocol/schemas'

console.log(hitlObjectSchema.$id)
console.log(verificationPolicySchema.$id)
console.log(submissionContextSchema.$id)
```

Or import individual schema files:

```typescript
import schema from '@hitl-protocol/schemas/verification-policy.schema.json' with { type: 'json' }
```

## Schemas

| Schema | Description |
|--------|-------------|
| `hitl-object.schema.json` | HITL object in HTTP 202 response |
| `poll-response.schema.json` | Poll endpoint response |
| `submit-request.schema.json` | Inline submit request body |
| `discovery-response.schema.json` | `.well-known/hitl.json` discovery response |
| `form-field.schema.json` | Form field definitions (Input reviews) |
| `verification-policy.schema.json` | Optional proof-of-human policy |
| `verification-result.schema.json` | Normalized verification outcome |
| `submission-context.schema.json` | Completed submission metadata |

## Exported Types

- `HitlObject`
- `PollResponse`
- `SubmitRequest`
- `VerificationPolicy`
- `VerificationResult`
- `SubmissionContext`
- `DiscoveryResponse`
- `FormField`
- `ReviewType`
- `ReviewStatus`

## Notes

- v0.8 standardizes a PoH-first verification layer through `verification_policy`, `verification_evidence`, `submission_context`, and `verification_result`.
- Agent identity lifecycle, capability grants, and revocation remain outside HITL core and are expected to be composed through external auth/control-plane profiles.

## License

Apache-2.0
