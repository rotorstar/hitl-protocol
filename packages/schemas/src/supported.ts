import type { ErrorObject } from 'ajv'
import * as v08 from './v0.8.js'
import * as v09 from './v0.9.js'

export type SupportedHitlObject = v08.HitlObject | v09.HitlObject
export type SupportedDiscoveryResponse = v08.DiscoveryResponse | v09.DiscoveryResponse
export interface SupportedValidator<T> {
  (data: unknown): data is T
  errors: ErrorObject[] | null
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const unsupported = (path: string): ErrorObject[] => [{
  keyword: 'supportedVersion', instancePath: path, schemaPath: '#/supportedVersion',
  params: { supported: ['0.8', '0.9'] }, message: 'must advertise a supported HITL version (0.8 or 0.9)',
}]

export const validateSupportedHitlObject: SupportedValidator<SupportedHitlObject> = Object.assign(
  (data: unknown): data is SupportedHitlObject => {
    const version = object(data) ? data.spec_version : undefined
    const validator = version === '0.8' ? v08.validateHitlObject : version === '0.9' ? v09.validateHitlObject : undefined
    if (!validator) {
      validateSupportedHitlObject.errors = unsupported('/spec_version')
      return false
    }
    const valid = validator(data)
    validateSupportedHitlObject.errors = validator.errors ?? null
    return valid
  }, { errors: null as ErrorObject[] | null },
)

export const validateSupportedDiscoveryResponse: SupportedValidator<SupportedDiscoveryResponse> = Object.assign(
  (data: unknown): data is SupportedDiscoveryResponse => {
    const version = object(data) && object(data.hitl_protocol) ? data.hitl_protocol.spec_version : undefined
    const validator = version === '0.8' ? v08.validateDiscoveryResponse : version === '0.9' ? v09.validateDiscoveryResponse : undefined
    if (!validator) {
      validateSupportedDiscoveryResponse.errors = unsupported('/hitl_protocol/spec_version')
      return false
    }
    const valid = validator(data)
    validateSupportedDiscoveryResponse.errors = validator.errors ?? null
    return valid
  }, { errors: null as ErrorObject[] | null },
)
