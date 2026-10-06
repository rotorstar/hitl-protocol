/** Local reference-service completion rules. These do not authenticate a person. */
import { validateSubmitRequest } from '@hitl-protocol/schemas/v0.8'
import addFormats from 'ajv-formats'
import type { ReviewResult, SubmissionContext, SubmitRequest } from '@hitl-protocol/schemas/v0.8'
import type { ReviewCase } from './types.js'
import { TERMINAL_STATES, transition } from './state-machine.js'

export class ReviewError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message)
  }
}

export interface ValidatedSubmission {
  result: ReviewResult
  submission_context: SubmissionContext
}

const ACTIONS = {
  approval: ['approve', 'edit', 'reject'],
  selection: ['select'],
  input: ['submit'],
  confirmation: ['confirm', 'cancel'],
  escalation: ['retry', 'skip', 'abort'],
} as const

const INPUT_FORMATS = { email: addFormats.get('email'), url: addFormats.get('uri') }

function matchesInputFormat(format: ReturnType<typeof addFormats.get>, value: string): boolean {
  if (format instanceof RegExp) return format.test(value)
  if (typeof format === 'function') return format(value) === true
  throw new ReviewError('invalid_form', 500, 'Unsupported input format validator.')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Browser requests have no inline channel claims; inline requests use the canonical v0.8 schema. */
export function parseSubmission(body: unknown, rc: ReviewCase, mode: 'browser_submit' | 'inline_submit'): ValidatedSubmission {
  if (!isObject(body) || typeof body.action !== 'string' || (body.data !== undefined && !isObject(body.data))) {
    throw new ReviewError('invalid_submission', 400, 'Expected an action string and an optional data object.')
  }
  let submissionContext: SubmissionContext = { mode }
  if (mode === 'inline_submit') {
    if (!validateSubmitRequest(body)) throw new ReviewError('invalid_submission', 400, 'Invalid inline submission.')
    const inline = body as unknown as SubmitRequest
    // This demo has no proof provider; never silently ignore required proof material.
    if (inline.verification_evidence?.length) throw new ReviewError('unsupported_verification', 400, 'This local demo does not verify external evidence.')
    if (!rc.inline_actions.includes(body.action)) throw new ReviewError('action_not_inline', 403, 'Use the original HITL review URL for this action.')
    submissionContext = { mode, submitted_via: inline.submitted_via, submitted_by: inline.submitted_by }
  } else if (Object.keys(body).some((key) => key !== 'action' && key !== 'data')) {
    throw new ReviewError('invalid_submission', 400, 'Browser submissions contain only action and data.')
  }
  if (!(ACTIONS[rc.type] as readonly string[]).includes(body.action)) {
    throw new ReviewError('invalid_action', 400, 'Unknown action for this review type.')
  }
  const data = isObject(body.data) ? body.data : {}
  if (rc.type === 'selection') {
    const items = Array.isArray(rc.context.items) ? rc.context.items : []
    const ids = new Set(items.filter(isObject).map((item) => item.id))
    if (!Array.isArray(data.selected) || data.selected.length === 0 || new Set(data.selected).size !== data.selected.length || data.selected.some((id) => typeof id !== 'string' || !ids.has(id))) {
      throw new ReviewError('invalid_selection', 400, 'Select one or more distinct available items.')
    }
  }
  if (rc.type === 'input') validateInput(data, rc.context.form)
  return structuredClone({ result: { action: body.action, data }, submission_context: submissionContext })
}

function validateInput(data: Record<string, unknown>, form: unknown): void {
  if (!isObject(form)) throw new ReviewError('invalid_form', 500, 'Missing form definition.')
  const fields = Array.isArray(form.steps)
    ? form.steps.filter(isObject).flatMap((step) => Array.isArray(step.fields) ? step.fields : [])
    : Array.isArray(form.fields) ? form.fields : []
  const definitions = fields.filter(isObject)
  if (Object.keys(data).some((key) => !definitions.some((field) => field.key === key))) {
    throw new ReviewError('invalid_input', 400, 'Unknown form field.')
  }
  for (const field of definitions) {
    if (typeof field.key !== 'string') throw new ReviewError('invalid_form', 500, 'Invalid form field.')
    const value = data[field.key]
    if (field.conditional && isObject(field.conditional)) {
      const condition = field.conditional
      const source = typeof condition.field === 'string' ? data[condition.field] : undefined
      const visible = condition.operator === 'eq' ? source === condition.value
        : condition.operator === 'neq' ? source !== condition.value
          : condition.operator === 'in' ? Array.isArray(condition.value) && condition.value.includes(source)
            : condition.operator === 'gt' ? Number(source) > Number(condition.value)
              : condition.operator === 'lt' && Number(source) < Number(condition.value)
      if (!visible) {
        if (value !== undefined) throw new ReviewError('invalid_input', 400, 'Hidden form fields must be omitted.')
        continue
      }
    }
    const missing = value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    if (missing && field.required === true) throw new ReviewError('invalid_input', 400, `Required field: ${field.key}.`)
    if (missing) continue
    const type = field.type
    if ((type === 'number' || type === 'range') ? typeof value !== 'number' || !Number.isFinite(value)
      : type === 'boolean' ? typeof value !== 'boolean'
        : type === 'multiselect' ? !Array.isArray(value) || value.some((item) => typeof item !== 'string')
          : typeof value !== 'string') throw new ReviewError('invalid_input', 400, `Invalid field type: ${field.key}.`)
    if (type === 'select' || type === 'multiselect') {
      const choices = Array.isArray(field.options) ? field.options.filter(isObject).map((option) => option.value) : []
      const selected = Array.isArray(value) ? value : [value]
      if (selected.some((item) => !choices.includes(item)) || new Set(selected).size !== selected.length) throw new ReviewError('invalid_input', 400, `Invalid choice: ${field.key}.`)
    }
    if (type === 'date' && typeof value === 'string') {
      const parsed = new Date(value)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ReviewError('invalid_input', 400, `Invalid date: ${field.key}.`)
    }
    if ((type === 'email' || type === 'url') && typeof value === 'string' && !matchesInputFormat(INPUT_FORMATS[type], value)) throw new ReviewError('invalid_input', 400, `Invalid ${type}: ${field.key}.`)
    const rules = isObject(field.validation) ? field.validation : {}
    if (typeof value === 'number' && ((typeof rules.min === 'number' && value < rules.min) || (typeof rules.max === 'number' && value > rules.max))) throw new ReviewError('invalid_input', 400, `Value out of range: ${field.key}.`)
    if (typeof value === 'string') {
      let pattern: RegExp | undefined
      if (typeof rules.pattern === 'string') {
        try { pattern = new RegExp(rules.pattern) } catch { throw new ReviewError('invalid_form', 500, `Invalid pattern for field: ${field.key}.`) }
      }
      if ((typeof rules.minLength === 'number' && value.length < rules.minLength) || (typeof rules.maxLength === 'number' && value.length > rules.maxLength) || (pattern && !pattern.test(value))) throw new ReviewError('invalid_input', 400, `Invalid value: ${field.key}.`)
    }
  }
}

/** The timer is an optimization; every request also resolves expiry from the deadline. */
export function expireCase(rc: ReviewCase, onTransition?: (rc: ReviewCase) => void, now = Date.now()): boolean {
  if (TERMINAL_STATES.includes(rc.status)) return false
  const deadline = Date.parse(rc.expires_at)
  if (!Number.isFinite(deadline)) throw new ReviewError('invalid_case', 500, 'Invalid review deadline.')
  if (now < deadline) return false
  transition(rc, 'expired', onTransition)
  return true
}

/** No await between final state/deadline check and mutation: atomic within the local process. */
export function completeCase(rc: ReviewCase, submission: ValidatedSubmission, onTransition?: (rc: ReviewCase) => void, now = Date.now()): void {
  const decision = structuredClone(submission)
  expireCase(rc, onTransition, now)
  if (rc.status === 'expired') throw new ReviewError('case_expired', 410, 'This review case has expired.')
  if (TERMINAL_STATES.includes(rc.status)) throw new ReviewError('duplicate_submission', 409, 'This review case is no longer accepting responses.')
  // transition cannot fail after the final check; observers run only after all decision fields are set.
  rc.result = decision.result
  rc.submission_context = decision.submission_context
  transition(rc, 'completed', onTransition)
}

export function pollCase(rc: ReviewCase): Record<string, unknown> {
  const response: Record<string, unknown> = { case_id: rc.case_id, status: rc.status, created_at: rc.created_at, expires_at: rc.expires_at }
  for (const key of ['opened_at', 'completed_at', 'expired_at', 'cancelled_at'] as const) if (rc[key]) response[key] = rc[key]
  if (rc.status === 'completed' && rc.result) {
    response.result = rc.result
    if (rc.submission_context) response.submission_context = rc.submission_context
    if (rc.responded_by) response.responded_by = rc.responded_by
  }
  if (rc.status === 'expired') response.default_action = rc.default_action
  return response
}

/** HTML script-data contexts require escaping '<', even for type=application/json. */
export function serializeReviewData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
