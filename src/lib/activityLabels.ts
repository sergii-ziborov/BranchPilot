import type { ActivityLogEntry, ActivityLogEventType } from '../shared/branchPilot'

export type ActivityCategory = 'all' | 'git' | 'assistant' | 'provider' | 'memory'
export type CompletedWorkSource = 'commit' | 'provider' | 'review' | 'linkedin' | 'assistant' | 'git'

export interface CompletedWorkItem {
  id: string
  title: string
  meta: string
  createdAt: string
  source: CompletedWorkSource
}

/** Classify an activity log entry into a high-level category. */
export function activityEntryCategory(entry: ActivityLogEntry): ActivityCategory {
  if (entry.actor === 'assistant') return 'assistant'
  if (entry.actor === 'provider') return 'provider'
  if (entry.type === 'assistant_policy_updated' || entry.type === 'assistant_action_blocked') return 'assistant'
  if (
    entry.type === 'project_memory_scanned' ||
    entry.type === 'project_wiki_generated' ||
    entry.type === 'repository_opened' ||
    entry.type === 'repository_refreshed'
  ) {
    return 'memory'
  }

  return 'git'
}

/** Display label for an activity category filter. */
export function activityCategoryLabel(category: ActivityCategory): string {
  if (category === 'git') return 'Git ops'
  if (category === 'assistant') return 'Assistant'
  if (category === 'provider') return 'Provider'
  if (category === 'memory') return 'Memory'
  return 'All'
}

/** Turn a snake_case event type into a Title Case label. */
export function activityTypeLabel(type: ActivityLogEventType): string {
  return type
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

/** Map an event type to the completed-work source it represents. */
export function completedWorkSource(type: ActivityLogEventType): CompletedWorkSource {
  if (type === 'github_pr_created') return 'provider'
  if (type === 'assistant_codex_agent_ran') return 'assistant'
  if (type === 'daily_review_generated') return 'review'
  if (type === 'assistant_linkedin_generated') return 'linkedin'
  return 'git'
}

/** Display label for a completed-work source. */
export function completedWorkSourceLabel(source: CompletedWorkSource): string {
  if (source === 'commit') return 'Commit'
  if (source === 'provider') return 'Provider'
  if (source === 'review') return 'Review'
  if (source === 'linkedin') return 'LinkedIn'
  if (source === 'assistant') return 'Assistant'
  return 'Git'
}

/** Compact metadata line for an activity entry, falling back to its title. */
export function activityMetadataLabel(entry: ActivityLogEntry): string {
  const parts = Object.entries(entry.metadata)
    .filter(([, value]) => value !== '' && value !== null)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)

  return parts.length > 0 ? parts.join(' · ') : entry.title
}
