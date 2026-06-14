import type { ReviewMode } from '../../src/shared/branchPilot.js'

/** Prompt builders for assistant generation tasks. */

export function buildReviewPrompt(context: {
  mode: ReviewMode
  scope: ReviewScope
  branch: string
  baseBranch?: string
  status: string
  commits: string
  diff: string
  truncated: boolean
}): string {
  return [
    `Run a ${reviewModeLabel(context.mode)} review for the ${context.scope} changes below.`,
    'Use only the provided Git context. This is report-only: do not suggest applying changes automatically.',
    'Return JSON only with this shape: {"summary":"...","findings":[{"severity":"medium","title":"...","details":"...","filePath":"optional","line":1,"recommendation":"optional"}]}',
    'Rules:',
    '- severity must be one of critical, high, medium, low, info;',
    '- include only actionable findings; use an empty findings array when there are no issues;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    'Review focus:',
    reviewFocus(context.mode),
    '',
    `Branch: ${context.branch}`,
    context.baseBranch ? `Base branch: ${context.baseBranch}` : 'Base branch: n/a',
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Git status:',
    context.status || '(clean)',
    '',
    'Relevant commits:',
    context.commits || '(none)',
    '',
    'Diff:',
    context.diff
  ].join('\n')
}

export function reviewModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'security'
  if (mode === 'quality') return 'change quality'
  return 'consistency'
}

export function reviewFocus(mode: ReviewMode): string {
  if (mode === 'security') {
    return 'Look for secrets, token leakage, unsafe shell/process execution, auth risks, destructive operations, and permission expansion.'
  }

  if (mode === 'quality') {
    return 'Look for likely bugs, edge cases, regressions, confusing behavior, compatibility issues, and missing validation.'
  }

  return 'Look for architecture boundary issues, naming problems, duplicated logic, missing tests, unrelated changes, and risky refactors.'
}

export function buildBranchDraftPrompt(context: {
  goal: string
  currentBranch: string
  status: string
  recentCommits: string
  diffContext: string
  truncated: boolean
}): string {
  return [
    'Generate a Git branch name and branch description for the work below.',
    'Use only the provided intent, Git status, commits, and diffs.',
    'Return JSON only with this shape: {"branchName":"feature/...","description":"..."}',
    'Rules:',
    '- branchName is required, lower-case, slash/kebab-case, and safe for git check-ref-format --branch;',
    '- use a prefix such as feature/, fix/, chore/, docs/, test/, or refactor/;',
    '- description is required, concise, and should explain the intent of the branch;',
    '- do not include spaces, quotes, markdown, or a remote prefix in branchName;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Current branch: ${context.currentBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'User intent:',
    context.goal || '(none)',
    '',
    'Git status:',
    context.status || '(clean)',
    '',
    'Recent commits:',
    context.recentCommits || '(none)',
    '',
    context.diffContext
  ].join('\n')
}

export function buildBranchDescriptionPrompt(context: {
  branchName: string
  currentBranch: string
  currentDescription: string
  recentCommits: string
  status: string
  diffContext: string
  truncated: boolean
}): string {
  return [
    'Generate a concise local Git branch description for the branch below.',
    'Use only the provided branch name, current description, commits, status, and diffs.',
    'Return JSON only with this shape: {"description":"..."}',
    'Rules:',
    '- description is required and should explain the purpose of the branch;',
    '- keep it useful as local Git branch metadata, not a pull request body;',
    '- do not mention that you are an AI assistant;',
    '- do not wrap the JSON in markdown fences.',
    '',
    `Branch: ${context.branchName}`,
    `Current checked-out branch: ${context.currentBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Current description:',
    context.currentDescription.trim() || '(none)',
    '',
    'Recent commits:',
    context.recentCommits || '(none)',
    '',
    'Git status:',
    context.status || '(not checked out)',
    '',
    context.diffContext || 'Diff context: (not checked out)'
  ].join('\n')
}

export function buildLinkedInProjectPrompt(context: {
  repositoryName: string
  currentBranch: string
  context: string
  truncated: boolean
}): string {
  return [
    'Generate a LinkedIn Project entry for the software repository below.',
    'Use only the provided repository context. This is suggest-only content: do not claim production impact, employer ownership, users, revenue, awards, or metrics unless visible in the context.',
    'Return JSON only with this exact shape: {"projectName":"...","headline":"...","role":"...","startDate":"YYYY-MM or Month YYYY","endDate":"YYYY-MM, Month YYYY, Present, or In progress","description":"...","highlights":["..."],"tags":["..."],"skills":["..."],"urlSuggestion":"...","markdown":"..."}',
    'Rules:',
    '- projectName should be LinkedIn-friendly and can improve the repository name without inventing a different product;',
    '- headline should be a short one-line project title/subtitle;',
    '- role should describe the contributor role, such as Creator, Full-stack developer, Desktop app developer, or Maintainer;',
    '- startDate and endDate should use the provided commit date range when available;',
    '- description should be first-person neutral or resume-style, 2-4 concise sentences;',
    '- highlights should contain 3-5 concrete bullets about features, architecture, or workflow;',
    '- tags should contain 5-12 hashtag-ready keywords without #;',
    '- skills should contain 5-12 LinkedIn skills/technologies;',
    '- markdown should combine the fields into a copyable LinkedIn-ready block;',
    '- do not mention that you are an AI assistant;',
    '- do not wrap the JSON in markdown fences.',
    '',
    `Repository: ${context.repositoryName}`,
    `Current branch: ${context.currentBranch}`,
    `Context truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    context.context
  ].join('\n')
}

export function buildPullRequestPrompt(context: {
  baseBranch: string
  headBranch: string
  commits: string
  diff: string
  truncated: boolean
}): string {
  return [
    'Generate a pull request title and description for the branch diff below.',
    'Use only the provided commits and branch diff. Do not infer from unstaged files.',
    'Return JSON only with this shape: {"title":"...","description":"..."}',
    'Rules:',
    '- title is required, concise, and suitable for a GitHub pull request;',
    '- description should summarize changes, testing, and risk when visible from the context;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Base branch: ${context.baseBranch}`,
    `Head branch: ${context.headBranch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Branch commits:',
    context.commits || '(none)',
    '',
    'Branch diff:',
    context.diff
  ].join('\n')
}

export function buildCommitPrompt(context: { branch: string; status: string; diff: string; truncated: boolean }): string {
  return [
    'Generate a Git commit message for the staged diff below.',
    'Use only the provided staged diff and status. Do not infer from unstaged files.',
    'Return JSON only with this shape: {"title":"...","description":"..."}',
    'Rules:',
    '- title is required, imperative mood, 72 characters or less when practical;',
    '- description is optional, concise, and should explain why the change matters;',
    '- do not wrap the JSON in markdown fences;',
    '- do not mention that you are an AI assistant.',
    '',
    `Branch: ${context.branch}`,
    `Diff truncated: ${context.truncated ? 'yes' : 'no'}`,
    '',
    'Staged status:',
    context.status || '(none)',
    '',
    'Staged diff:',
    context.diff
  ].join('\n')
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false }
  }

  return {
    text: Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8'),
    truncated: true
  }
}
