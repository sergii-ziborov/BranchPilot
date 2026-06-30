import type {
  GeneratedLinkedInProject, GeneratedRepositoryStarter, ReviewFinding, ReviewSeverity
} from '../../src/shared/branchPilot.js'
import { BranchPilotUserError } from '../lib/errors.js'

/** Parsers and normalizers for assistant output payloads. */

export function parseGeneratedText(output: string, titleLabel: string): { title: string; description: string } {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const title = typeof candidate?.title === 'string' ? candidate.title.trim() : ''
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!title) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      `Assistant did not return a valid ${titleLabel}.`,
      output.slice(0, 2_000)
    )
  }

  return {
    title,
    description
  }
}

export function parseBranchDraft(output: string): { branchName: string; description: string } {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const branchName = typeof candidate?.branchName === 'string' ? candidate.branchName.trim() : ''
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!branchName) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid branch name.',
      output.slice(0, 2_000)
    )
  }

  return {
    branchName: normalizeBranchName(branchName, 'Branch name'),
    description
  }
}

export function parseBranchDescription(output: string): string {
  const parsed = parseJsonLike(output)
  const candidate = normalizeAssistantPayload(parsed)
  const description = typeof candidate?.description === 'string' ? candidate.description.trim() : ''

  if (!description) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid branch description.',
      output.slice(0, 2_000)
    )
  }

  return description
}

export function parseLinkedInProject(output: string): Omit<GeneratedLinkedInProject, 'assistant' | 'truncated'> {
  const parsed = normalizeAssistantPayload(parseJsonLike(output))
  const projectName = stringField(parsed, 'projectName')
  const headline = stringField(parsed, 'headline')
  const role = stringField(parsed, 'role')
  const startDate = stringField(parsed, 'startDate')
  const endDate = stringField(parsed, 'endDate')
  const description = stringField(parsed, 'description')
  const highlights = stringArrayField(parsed, 'highlights')
  const tags = stringArrayField(parsed, 'tags')
  const skills = stringArrayField(parsed, 'skills')
  const urlSuggestion = stringField(parsed, 'urlSuggestion', false)
  const markdown = stringField(parsed, 'markdown', false) || formatLinkedInMarkdown({
    projectName,
    headline,
    role,
    startDate,
    endDate,
    description,
    highlights,
    tags,
    skills,
    urlSuggestion
  })

  if (!projectName || !headline || !role || !startDate || !endDate || !description) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid LinkedIn project entry.',
      output.slice(0, 2_000)
    )
  }

  return {
    projectName,
    headline,
    role,
    startDate,
    endDate,
    description,
    highlights,
    tags,
    skills,
    urlSuggestion,
    markdown
  }
}

export function parseRepositoryStarter(output: string): Omit<GeneratedRepositoryStarter, 'assistant' | 'truncated'> {
  const parsed = normalizeAssistantPayload(parseJsonLike(output))
  const description = stringField(parsed, 'description')
  const readme = stringField(parsed, 'readme')
  const gitignore = stringField(parsed, 'gitignore', false)

  if (!description || !readme) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return valid repository starter content.',
      output.slice(0, 2_000)
    )
  }

  return {
    description: description.slice(0, 350),
    readme,
    gitignore
  }
}

export function parseBeautifiedFile(output: string): string {
  const parsed = normalizeAssistantPayload(parseJsonLike(output))
  const content = typeof parsed.content === 'string' ? parsed.content : ''

  if (typeof parsed.content !== 'string') {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return beautified file content.',
      output.slice(0, 2_000)
    )
  }

  return content
}

export function stringField(parsed: Record<string, unknown>, key: string, required = true): string {
  const value = typeof parsed[key] === 'string' ? parsed[key].trim() : ''

  if (required && !value) {
    return ''
  }

  return value
}

export function stringArrayField(parsed: Record<string, unknown>, key: string): string[] {
  if (!Array.isArray(parsed[key])) {
    return []
  }

  return parsed[key]
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
    .slice(0, 16)
}

export function formatLinkedInMarkdown(project: Omit<GeneratedLinkedInProject, 'assistant' | 'truncated' | 'markdown'>): string {
  return [
    `# ${project.projectName}`,
    project.headline,
    '',
    `Role: ${project.role}`,
    `Dates: ${project.startDate} - ${project.endDate}`,
    project.urlSuggestion ? `URL: ${project.urlSuggestion}` : '',
    '',
    project.description,
    '',
    'Highlights:',
    ...project.highlights.map((highlight) => `- ${highlight}`),
    '',
    project.skills.length > 0 ? `Skills: ${project.skills.join(', ')}` : '',
    project.tags.length > 0 ? `Tags: ${project.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}` : ''
  ].filter((line) => line !== '').join('\n')
}


export function parseReviewReport(output: string): { summary: string; findings: ReviewFinding[] } {
  const parsed = normalizeAssistantPayload(parseJsonLike(output))
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : []

  if (!summary) {
    throw new BranchPilotUserError(
      'assistant_parse_failed',
      'Assistant did not return a valid review summary.',
      output.slice(0, 2_000)
    )
  }

  return {
    summary,
    findings: rawFindings
      .map(normalizeReviewFinding)
      .filter((finding): finding is ReviewFinding => Boolean(finding))
  }
}

export function normalizeReviewFinding(value: unknown): ReviewFinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const severity = normalizeSeverity(candidate.severity)
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
  const details = typeof candidate.details === 'string' ? candidate.details.trim() : ''

  if (!severity || !title || !details) {
    return undefined
  }

  return {
    severity,
    title,
    details,
    filePath: typeof candidate.filePath === 'string' && candidate.filePath.trim() ? candidate.filePath.trim() : undefined,
    line: typeof candidate.line === 'number' && Number.isFinite(candidate.line) ? candidate.line : undefined,
    recommendation: typeof candidate.recommendation === 'string' && candidate.recommendation.trim()
      ? candidate.recommendation.trim()
      : undefined
  }
}

export function normalizeSeverity(value: unknown): ReviewSeverity | undefined {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value
  }

  return undefined
}

export function normalizeBranchName(branchName: string, label: string): string {
  const trimmed = branchName.trim()

  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new BranchPilotUserError('invalid_branch', `${label} is invalid.`)
  }

  return trimmed
}

export function normalizeAssistantPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  if (typeof parsed.result === 'string') {
    return parseJsonLike(parsed.result)
  }

  if (parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result)) {
    return parsed.result as Record<string, unknown>
  }

  return parsed
}

export function parseJsonLike(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const direct = tryParseJson(trimmed)

  if (direct) {
    return direct
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = tryParseJson(trimmed.slice(firstBrace, lastBrace + 1))

    if (extracted) {
      return extracted
    }
  }

  throw new BranchPilotUserError(
    'assistant_parse_failed',
    'Assistant did not return valid JSON.',
    output.slice(0, 2_000)
  )
}

export function tryParseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
