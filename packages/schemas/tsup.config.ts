import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/v0.8.ts', 'src/v0.9.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
})
