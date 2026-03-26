# HITL Protocol JSON Schemas

This directory contains the canonical JSON Schema definitions for HITL Protocol v0.8.

## Schemas

| Schema | Description | Validates |
|--------|-------------|-----------|
| [`hitl-object.schema.json`](hitl-object.schema.json) | The `hitl` object within an HTTP 202 response | Service → Agent |
| [`poll-response.schema.json`](poll-response.schema.json) | Response from the poll endpoint | Service → Agent |
| [`submit-request.schema.json`](submit-request.schema.json) | Inline submit request body (`submit_url` flow) | Agent → Service |
| [`discovery-response.schema.json`](discovery-response.schema.json) | `.well-known/hitl.json` discovery response | Service → Agent |
| [`form-field.schema.json`](form-field.schema.json) | Form field definition for Input-type reviews | `context.form.fields[]` |
| [`verification-policy.schema.json`](verification-policy.schema.json) | Optional proof-of-human policy on a HITL object | `hitl.verification_policy` |
| [`verification-result.schema.json`](verification-result.schema.json) | Normalized provider-agnostic verification outcome | `submission_context.verification_result` |
| [`submission-context.schema.json`](submission-context.schema.json) | Completed submission path metadata | `poll_response.submission_context` |

## Usage

### JavaScript / TypeScript

```typescript
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import hitlSchema from './hitl-object.schema.json'
import pollSchema from './poll-response.schema.json'
import submitRequestSchema from './submit-request.schema.json'
import formFieldSchema from './form-field.schema.json'
import verificationPolicySchema from './verification-policy.schema.json'
import verificationResultSchema from './verification-result.schema.json'
import submissionContextSchema from './submission-context.schema.json'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)

ajv.addSchema(formFieldSchema, 'form-field.json')
ajv.addSchema(verificationPolicySchema, 'verification-policy.schema.json')
ajv.addSchema(verificationResultSchema, 'verification-result.schema.json')
ajv.addSchema(submissionContextSchema, 'submission-context.schema.json')

const validateHitl = ajv.compile(hitlSchema)
const validatePoll = ajv.compile(pollSchema)
const validateSubmit = ajv.compile(submitRequestSchema)

if (!validateHitl(response.json().hitl)) {
  console.error(validateHitl.errors)
}

if (!validatePoll(pollResponse)) {
  console.error(validatePoll.errors)
}

if (!validateSubmit(submitRequest)) {
  console.error(validateSubmit.errors)
}
```

### Python

```python
import json
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

def resource(schema):
    return Resource.from_contents(schema, default_specification=DRAFT202012)

with open("hitl-object.schema.json") as f:
    hitl_schema = json.load(f)
with open("poll-response.schema.json") as f:
    poll_schema = json.load(f)
with open("form-field.schema.json") as f:
    form_field_schema = json.load(f)
with open("verification-policy.schema.json") as f:
    verification_policy_schema = json.load(f)
with open("verification-result.schema.json") as f:
    verification_result_schema = json.load(f)
with open("submission-context.schema.json") as f:
    submission_context_schema = json.load(f)

registry = Registry().with_resources([
    ("form-field.json", resource(form_field_schema)),
    ("verification-policy.schema.json", resource(verification_policy_schema)),
    ("verification-result.schema.json", resource(verification_result_schema)),
    ("submission-context.schema.json", resource(submission_context_schema)),
])

hitl_validator = Draft202012Validator(hitl_schema, registry=registry)
poll_validator = Draft202012Validator(poll_schema, registry=registry)
```

### CLI (ajv-cli)

```bash
npm install -g ajv-cli ajv-formats

ajv validate \
  -s schemas/hitl-object.schema.json \
  -r schemas/form-field.schema.json \
  -r schemas/verification-policy.schema.json \
  -r schemas/verification-result.schema.json \
  -r schemas/submission-context.schema.json \
  -d payload.json \
  --spec=draft2020 \
  -c ajv-formats
```

## Schema Version

These schemas correspond to HITL Protocol **v0.8**. The root `spec_version` fields are constrained to `"0.8"`.

## JSON Schema Draft

All schemas use [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema).
