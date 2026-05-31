import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  Braces,
  Building2,
  CircleDot,
  Cloud,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  TerminalSquare
} from 'lucide-react'

export type ProviderState = 'Connected' | 'Planned'
export type ReviewSeverity = 'Ready' | 'Needs setup'

export interface ProviderSummary {
  name: string
  state: ProviderState
  icon: LucideIcon
}

export interface WorkItem {
  label: string
  value: string
}

export interface ReviewMode {
  title: string
  description: string
  state: ReviewSeverity
  icon: LucideIcon
}

export const providerSummaries: ProviderSummary[] = [
  { name: 'GitHub', state: 'Connected', icon: FolderGit2 },
  { name: 'GitLab', state: 'Planned', icon: Cloud },
  { name: 'Bitbucket', state: 'Planned', icon: Building2 }
]

export const repositoryStats: WorkItem[] = [
  { label: 'Changed files', value: '8' },
  { label: 'Staged', value: '3' },
  { label: 'Current branch', value: 'feature/review-panel' },
  { label: 'Remote', value: 'origin/main' }
]

export const changeList = [
  { path: 'src/repositories/RepositoryView.tsx', status: 'Modified', additions: 82, deletions: 18 },
  { path: 'src/git/commandRunner.ts', status: 'Modified', additions: 41, deletions: 9 },
  { path: 'src/review/securityChecks.ts', status: 'Added', additions: 128, deletions: 0 },
  { path: 'package.json', status: 'Modified', additions: 7, deletions: 2 }
]

export const reviewModes: ReviewMode[] = [
  {
    title: 'Consistency',
    description: 'Architecture, naming, and flow checks before a commit.',
    state: 'Ready',
    icon: BadgeCheck
  },
  {
    title: 'Security',
    description: 'Secrets, risky shell usage, and dependency signals.',
    state: 'Ready',
    icon: ShieldCheck
  },
  {
    title: 'Daily review',
    description: 'A concise work journal from local changes and commits.',
    state: 'Needs setup',
    icon: MessageSquareText
  }
]

export const navigationItems = [
  { label: 'Changes', icon: GitBranch },
  { label: 'Pull requests', icon: GitPullRequest },
  { label: 'Review', icon: Sparkles },
  { label: 'Terminal Git', icon: TerminalSquare },
  { label: 'Providers', icon: CircleDot },
  { label: 'Access', icon: LockKeyhole }
]

export const diffPreview = [
  { marker: '+', text: 'export async function runRepositoryCheck(path: string) {' },
  { marker: '+', text: '  const status = await git.status(path)' },
  { marker: '+', text: '  return buildReviewReport(status)' },
  { marker: ' ', text: '}' },
  { marker: '-', text: 'export function runCheck() {}' }
]

export const localCapabilities = [
  { label: 'Commit title', icon: Sparkles },
  { label: 'Description draft', icon: Braces },
  { label: 'Review report', icon: ShieldCheck }
]
