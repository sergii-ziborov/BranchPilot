import { Bot, Database, FolderGit2, FolderOpen, GitBranch, Tags, UserRound } from 'lucide-react'

export type SettingsTab = 'identity' | 'assistant' | 'remotes' | 'submodules' | 'lfs' | 'worktrees' | 'tags'

export interface SettingsTabCounts {
  remotes: number
  submodules: number
  worktrees: number
  tags: number
  lfsItems: number
}

const SETTINGS_TABS = [
  { id: 'identity', label: 'Identity', Icon: UserRound },
  { id: 'assistant', label: 'Assistant', Icon: Bot },
  { id: 'remotes', label: 'Remotes', Icon: FolderGit2 },
  { id: 'submodules', label: 'Submodules', Icon: GitBranch },
  { id: 'lfs', label: 'Git LFS', Icon: Database },
  { id: 'worktrees', label: 'Worktrees', Icon: FolderOpen },
  { id: 'tags', label: 'Tags', Icon: Tags }
] as const

function settingsTabCount(tab: SettingsTab, counts: SettingsTabCounts): number | null {
  if (tab === 'remotes') return counts.remotes
  if (tab === 'submodules') return counts.submodules
  if (tab === 'lfs') return counts.lfsItems
  if (tab === 'worktrees') return counts.worktrees
  if (tab === 'tags') return counts.tags
  return null
}

export function SettingsTabs({
  activeTab,
  counts,
  onChange
}: {
  activeTab: SettingsTab
  counts: SettingsTabCounts
  onChange: (tab: SettingsTab) => void
}) {
  return (
    <div className="settings-switch" role="tablist" aria-label="Settings sections">
      {SETTINGS_TABS.map(({ id, label, Icon }) => {
        const selected = activeTab === id
        const count = settingsTabCount(id, counts)

        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? 'active' : ''}
            key={id}
            onClick={() => onChange(id)}
          >
            <Icon size={15} />
            {label}
            {count !== null && count > 0 && <span>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
