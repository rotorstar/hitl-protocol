/**
 * Copies JSON schema files from the repository root schemas/ directory
 * into packages/schemas/schemas/ for npm publishing.
 *
 * Source of truth: ../../schemas/*.schema.json (+ form-field.json for $ref)
 */

import { cpSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_SCHEMAS = join(__dirname, '..', '..', '..', 'schemas')
const PKG_SCHEMAS = join(__dirname, '..', 'schemas')

mkdirSync(PKG_SCHEMAS, { recursive: true })

const files = [
  'hitl-object.schema.json',
  'poll-response.schema.json',
  'form-field.schema.json',
  'submit-request.schema.json',
  'form-field.json', // $ref target for hitl-object.schema.json (symlink in source)
]

for (const file of files) {
  // Resolve symlinks so npm pack gets real files
  const src = realpathSync(join(ROOT_SCHEMAS, file))
  cpSync(src, join(PKG_SCHEMAS, file))
}

console.log(`Copied ${files.length} schema files to packages/schemas/schemas/`)
