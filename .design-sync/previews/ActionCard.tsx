import { Clock3, Code2, GitPullRequest } from 'lucide-react'
import { ActionCard } from 'branchpilot'

const noop = () => {}

export const ActionRow = () => (
  <div className="no-changes-cards">
    <ActionCard
      icon={<Code2 size={18} />}
      title="Open in your editor"
      description="Edit files in your configured editor."
      onClick={noop}
    />
    <ActionCard
      icon={<Clock3 size={18} />}
      title="Review history"
      description="Browse past commits on this branch."
      onClick={noop}
    />
    <ActionCard
      icon={<GitPullRequest size={18} />}
      title="Pull requests"
      description="Open or create a pull request."
      onClick={noop}
    />
  </div>
)

export const SingleCard = () => (
  <div className="no-changes-cards">
    <ActionCard
      icon={<Code2 size={18} />}
      title="Open in your editor"
      description="Edit files in your configured editor."
      onClick={noop}
    />
  </div>
)

export const Disabled = () => (
  <div className="no-changes-cards">
    <ActionCard
      icon={<Code2 size={18} />}
      title="Open in your editor"
      description="No editor configured yet."
      disabled
    />
  </div>
)
