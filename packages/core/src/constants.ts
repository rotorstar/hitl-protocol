/**
 * Protocol constants and sample data for HITL Protocol v0.6.
 */

import type { ReviewType } from '@hitl-protocol/schemas'

/** Actions allowed per review type for inline submit (v0.6). */
export const INLINE_ACTIONS: Readonly<Record<ReviewType, readonly string[]>> = {
  confirmation: ['confirm', 'cancel'],
  escalation: ['retry', 'skip', 'abort'],
  approval: ['approve', 'reject'],
  selection: [],
  input: [],
}

/** Default prompts per review type (demo/reference use). */
export const PROMPTS: Readonly<Record<ReviewType, string>> = {
  selection: 'Select which jobs to apply for',
  approval: 'Approve production deployment v2.4.0',
  input: 'Provide application details',
  confirmation: 'Confirm sending 2 emails',
  escalation: 'Deployment failed — decide how to proceed',
}

/** Sample context objects per review type (demo/reference use). */
export const SAMPLE_CONTEXTS: Readonly<Record<ReviewType, Record<string, unknown>>> = {
  selection: {
    items: [
      { id: 'job_001', title: 'Senior Frontend Engineer', description: 'React/Next.js at TechCorp, Berlin.', metadata: { salary: '85-110k EUR', remote: 'Hybrid' } },
      { id: 'job_002', title: 'Full-Stack Developer', description: 'Node.js + React at StartupXYZ.', metadata: { salary: '70-95k EUR', remote: 'Fully remote' } },
      { id: 'job_003', title: 'Tech Lead', description: 'Team of 8, microservices.', metadata: { salary: '110-140k EUR', remote: 'On-site' } },
    ],
  },
  approval: {
    artifact: {
      title: 'Production Deployment v2.4.0',
      content: 'Changes:\n- Updated auth\n- Fixed rate limiter\n\nRisk: Medium\nRollback: Automated',
      metadata: { environment: 'production', commit: 'a1b2c3d' },
    },
  },
  input: {
    form: {
      fields: [
        { key: 'salary_expectation', label: 'Salary Expectation (EUR)', type: 'number', required: true, validation: { min: 30000, max: 300000 } },
        { key: 'start_date', label: 'Earliest Start Date', type: 'date', required: true },
        { key: 'work_auth', label: 'Work Authorization', type: 'select', required: true, options: [{ value: 'citizen', label: 'EU Citizen' }, { value: 'blue_card', label: 'Blue Card' }, { value: 'visa_required', label: 'Visa Required' }] },
      ],
    },
  },
  confirmation: {
    description: 'The following emails will be sent:',
    items: [
      { id: 'email_1', label: 'Application to TechCorp' },
      { id: 'email_2', label: 'Application to StartupXYZ' },
    ],
  },
  escalation: {
    error: {
      title: 'Deployment Failed',
      summary: 'Container OOMKilled during startup',
      details: 'Error: OOMKilled\nMemory: 2.1GB / 2GB',
    },
    params: { memory: '2GB', replicas: '3' },
  },
}
