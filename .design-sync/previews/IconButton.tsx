import { IconButton } from 'branchpilot'
import { RefreshCw, GitBranch, Trash2, Settings } from 'lucide-react'

export const Default = () => (
  <IconButton icon={<RefreshCw size={17} />} label="Refresh repository" />
)

export const Toolbar = () => (
  <div className="toolbar" style={{ display: 'flex', gap: 8 }} aria-label="Repository actions">
    <IconButton icon={<RefreshCw size={17} />} label="Refresh repository" />
    <IconButton icon={<GitBranch size={17} />} label="Switch branch" active />
    <IconButton icon={<Settings size={17} />} label="Repository settings" />
    <IconButton icon={<Trash2 size={17} />} label="Delete worktree" tone="danger" />
  </div>
)

export const Active = () => (
  <IconButton icon={<GitBranch size={17} />} label="Switch branch" active />
)

export const Danger = () => (
  <IconButton icon={<Trash2 size={17} />} label="Delete tag" tone="danger" />
)

export const Disabled = () => (
  <IconButton icon={<RefreshCw size={17} />} label="Refresh repository" disabled />
)
