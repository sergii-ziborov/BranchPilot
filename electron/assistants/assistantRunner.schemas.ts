/** JSON schemas and size limits for assistant generation requests. */

export const MAX_ASSISTANT_DIFF_BYTES = 80_000
export const MAX_ASSISTANT_BRANCH_CONTEXT_BYTES = 100_000
export const MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES = 100_000
export const MAX_ASSISTANT_PR_DIFF_BYTES = 120_000
export const MAX_ASSISTANT_REVIEW_DIFF_BYTES = 120_000

export const GENERATED_TEXT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description'],
  properties: {
    title: {
      type: 'string',
      minLength: 1
    },
    description: {
      type: 'string'
    }
  }
}

export const BRANCH_DRAFT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['branchName', 'description'],
  properties: {
    branchName: {
      type: 'string',
      minLength: 1
    },
    description: {
      type: 'string'
    }
  }
}

export const BRANCH_DESCRIPTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['description'],
  properties: {
    description: {
      type: 'string',
      minLength: 1
    }
  }
}

export const REVIEW_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: {
      type: 'string'
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'details', 'filePath', 'line', 'recommendation'],
        properties: {
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'info']
          },
          title: {
            type: 'string'
          },
          details: {
            type: 'string'
          },
          filePath: {
            type: ['string', 'null']
          },
          line: {
            type: ['number', 'null']
          },
          recommendation: {
            type: ['string', 'null']
          }
        }
      }
    }
  }
}

export const LINKEDIN_PROJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['projectName', 'headline', 'role', 'startDate', 'endDate', 'description', 'highlights', 'tags', 'skills', 'urlSuggestion', 'markdown'],
  properties: {
    projectName: { type: 'string', minLength: 1 },
    headline: { type: 'string', minLength: 1 },
    role: { type: 'string', minLength: 1 },
    startDate: { type: 'string', minLength: 1 },
    endDate: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    highlights: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    urlSuggestion: { type: 'string' },
    markdown: { type: 'string', minLength: 1 }
  }
}

