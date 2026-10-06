/** Canonical root schemas are v0.9; v0.8 is an immutable archive. */
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas')
const DESTINATION = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas')
const files = readdirSync(ROOT).filter((file) => file.endsWith('.schema.json'))
rmSync(DESTINATION, { recursive: true, force: true })
mkdirSync(DESTINATION, { recursive: true })
for (const version of ['0.8', '0.9']) {
  const destination = join(DESTINATION, `v${version}`)
  const source = version === '0.8' ? join(ROOT, 'v0.8') : ROOT
  mkdirSync(destination, { recursive: true })
  for (const file of files) {
    for (const name of [file, file.replace('.schema.json', '.json')]) {
      cpSync(join(source, file), join(destination, name))
      if (version === '0.9') cpSync(join(source, file), join(DESTINATION, name))
    }
  }
}
