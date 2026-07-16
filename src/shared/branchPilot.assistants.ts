export type AssistantPolicyMode =
  | 'disabled'
  | 'review-only'
  | 'suggest-only'
  | 'allow-local-commands'
  | 'allow-file-edits'

export type AssistantActionKind =
  | 'commit_message'
  | 'pull_request_text'
  | 'review_report'
  | 'branch_draft'
  | 'linkedin_project'
  | 'repository_starter'
  | 'file_beautify'
  | 'codex_agent'

export interface AssistantPolicySettings {
  repoPath: string
  mode: AssistantPolicyMode
  updatedAt: string
}

export interface AssistantPolicyStatus {
  settings: AssistantPolicySettings
  allowedActions: AssistantActionKind[]
  lockedModes: AssistantPolicyMode[]
}

export interface AssistantPolicyUpdate {
  repoPath: string
  mode: AssistantPolicyMode
}

export type ActivityLogEventType =
  | 'repository_opened'
  | 'repository_cloned'
  | 'repository_refreshed'
  | 'project_memory_scanned'
  | 'project_wiki_generated'
  | 'assistant_policy_updated'
  | 'assistant_action_blocked'
  | 'commit_created'
  | 'commit_amended'
  | 'commit_reverted'
  | 'commit_cherry_picked'
  | 'commit_reset'
  | 'branch_created'
  | 'branch_description_updated'
  | 'branch_renamed'
  | 'branch_upstream_updated'
  | 'branch_switched'
  | 'branch_deleted'
  | 'remote_added'
  | 'remote_updated'
  | 'remote_removed'
  | 'tag_created'
  | 'tag_deleted'
  | 'worktree_created'
  | 'worktree_removed'
  | 'submodule_updated'
  | 'git_lfs_pulled'
  | 'patch_exported'
  | 'patch_applied'
  | 'git_fetched'
  | 'git_pulled'
  | 'git_pushed'
  | 'git_force_pushed'
  | 'branch_published'
  | 'stash_created'
  | 'stash_applied'
  | 'stash_dropped'
  | 'merge_started'
  | 'rebase_started'
  | 'merge_continued'
  | 'merge_aborted'
  | 'merge_resolved'
  | 'assistant_commit_generated'
  | 'assistant_branch_generated'
  | 'assistant_pr_generated'
  | 'assistant_linkedin_generated'
  | 'assistant_repository_starter_generated'
  | 'assistant_file_beautified'
  | 'assistant_review_generated'
  | 'assistant_codex_agent_ran'
  | 'assistant_session_note'
  | 'daily_review_generated'
  | 'github_pr_created'
  | 'github_repository_created'
  | 'github_pr_checked_out'
  | 'github_pr_details_loaded'

export type ActivityLogActor = 'user' | 'branchpilot' | 'assistant' | 'provider'
export type ActivityLogStatus = 'success' | 'failure'
export type ActivityLogMetadataValue = string | number | boolean | null
export type ActivityLogMetadata = Record<string, ActivityLogMetadataValue>

export interface ActivityLogEntry {
  id: string
  repoPath: string
  type: ActivityLogEventType
  actor: ActivityLogActor
  status: ActivityLogStatus
  title: string
  createdAt: string
  metadata: ActivityLogMetadata
}

export interface ActivityLogQuery {
  repoPath: string
  types?: ActivityLogEventType[]
  actor?: ActivityLogActor
  status?: ActivityLogStatus
  limit?: number
}

export interface ActivityLogSnapshot {
  repoPath: string
  entries: ActivityLogEntry[]
  totalCount: number
}

export type DailyReviewSectionId = 'summary' | 'commits' | 'worktree' | 'sync' | 'activity' | 'next_actions'
export type DailyReviewActionPriority = 'high' | 'normal'

export interface DailyReviewRequest {
  repoPath: string
  repoPaths?: string[]
  date?: string
}

export interface DailyReviewStats {
  commits: number
  activities: number
  changed: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  ahead: number
  behind: number
}

export interface DailyReviewSection {
  id: DailyReviewSectionId
  title: string
  items: string[]
}

export interface DailyReviewActionItem {
  title: string
  details: string
  priority: DailyReviewActionPriority
}

export interface DailyReviewReport {
  repoPath: string
  repositoryName: string
  branch: string
  date: string
  generatedAt: string
  stats: DailyReviewStats
  sections: DailyReviewSection[]
  actionItems: DailyReviewActionItem[]
  markdown: string
}

