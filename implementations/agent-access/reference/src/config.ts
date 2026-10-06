import { z } from 'zod'
import { requireTrustedEndpoint } from '@hitl-protocol/agent-access'

const ConfigSchema = z.object({
  DATABASE_URL: z.url().default('postgresql://hitl:hitl-local@127.0.0.1:5459/hitl'),
  PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:8789'),
  OIDC_ISSUER: z.url().default('http://localhost:8189/realms/hitl'),
  OIDC_AUDIENCE: z.string().default('http://127.0.0.1:8789'),
  OIDC_BROWSER_CLIENT_ID: z.string().default('hitl-browser'),
  OIDC_BROWSER_CLIENT_SECRET: z.string().min(1),
  OIDC_INTROSPECTION_CLIENT_ID: z.string().default('hitl-resource'),
  OIDC_INTROSPECTION_CLIENT_SECRET: z.string().min(1),
  SERVICE_NAMESPACE: z.string().regex(/^[a-z0-9-]+$/).default('reference'),
  POLICY_VERSION: z.coerce.number().int().positive().default(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(8789),
  HOST: z.string().default('127.0.0.1'),
  ALLOW_INSECURE_LOCALHOST: z.enum(['true', 'false']).default('false'),
})
export type Config = z.infer<typeof ConfigSchema>
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const config = ConfigSchema.parse(env)
  for (const value of [config.PUBLIC_BASE_URL, config.OIDC_ISSUER]) {
    requireTrustedEndpoint(value, config.ALLOW_INSECURE_LOCALHOST === 'true')
  }
  if (new URL(config.PUBLIC_BASE_URL).pathname !== '/' || new URL(config.PUBLIC_BASE_URL).search || new URL(config.PUBLIC_BASE_URL).hash) {
    throw new Error('PUBLIC_BASE_URL must be an origin')
  }
  config.PUBLIC_BASE_URL = new URL(config.PUBLIC_BASE_URL).origin
  const issuer = new URL(config.OIDC_ISSUER)
  if (issuer.search || issuer.href.endsWith('/')) throw new Error('OIDC_ISSUER must have no query or trailing slash')
  return config
}
