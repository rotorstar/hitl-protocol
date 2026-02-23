# HITL Protocol JSON Schemas

This directory contains JSON Schema definitions for validating HITL Protocol messages.

## Schemas

| Schema | Description | Validates |
|--------|-------------|-----------|
| [`hitl-object.schema.json`](hitl-object.schema.json) | The `hitl` object within an HTTP 202 response | Service → Agent |
| [`poll-response.schema.json`](poll-response.schema.json) | Response from the poll endpoint | Service → Agent |

## Usage

### JavaScript / TypeScript

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import hitlSchema from "./hitl-object.schema.json";
import pollSchema from "./poll-response.schema.json";

const ajv = new Ajv();
addFormats(ajv);

const validateHitl = ajv.compile(hitlSchema);
const validatePoll = ajv.compile(pollSchema);

// Validate a HITL object
const hitlObject = response.json().hitl;
if (!validateHitl(hitlObject)) {
  console.error("Invalid HITL object:", validateHitl.errors);
}

// Validate a poll response
const pollResponse = await fetch(hitlObject.poll_url).then(r => r.json());
if (!validatePoll(pollResponse)) {
  console.error("Invalid poll response:", validatePoll.errors);
}
```

### Python

```python
import json
from jsonschema import validate, ValidationError

with open("hitl-object.schema.json") as f:
    hitl_schema = json.load(f)

with open("poll-response.schema.json") as f:
    poll_schema = json.load(f)

# Validate a HITL object
try:
    validate(instance=hitl_object, schema=hitl_schema)
except ValidationError as e:
    print(f"Invalid HITL object: {e.message}")

# Validate a poll response
try:
    validate(instance=poll_response, schema=poll_schema)
except ValidationError as e:
    print(f"Invalid poll response: {e.message}")
```

### CLI (ajv-cli)

```bash
# Install
npm install -g ajv-cli ajv-formats

# Validate
ajv validate -s hitl-object.schema.json -d example.json --spec=draft2020 -c ajv-formats
```

## Schema Version

These schemas correspond to HITL Protocol **v0.5**. The `spec_version` field is constrained to `"0.5"`.

## JSON Schema Draft

All schemas use [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema).
