import { useState } from 'react'
import { GitBranch, GitCommitHorizontal, ShieldCheck, Tag, Users } from 'lucide-react'
import { Chip } from 'branchpilot'

export const StaticTags = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Chip label="Changes" leadingIcon={<GitCommitHorizontal size={13} />} />
    <Chip label="Branches" leadingIcon={<GitBranch size={13} />} />
    <Chip label="Review" leadingIcon={<ShieldCheck size={13} />} />
  </div>
)

export const StackHints = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Chip label="TypeScript" title="tsconfig.json" />
    <Chip label="React" title="package.json" />
    <Chip label="Electron" title="package.json" />
    <Chip label="Vite" title="vite.config.ts" />
  </div>
)

export const Selectable = () => {
  const [active, setActive] = useState('origin/main')
  const branches = ['origin/main', 'feature/design-sync', 'release/2.4']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {branches.map((branch) => (
        <Chip
          key={branch}
          label={branch}
          leadingIcon={<GitBranch size={13} />}
          selected={branch === active}
          onClick={() => setActive(branch)}
        />
      ))}
    </div>
  )
}

export const Removable = () => {
  const [coAuthors, setCoAuthors] = useState(['Serhii Ziborov', 'Dana Whitfield'])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {coAuthors.map((name) => (
        <Chip
          key={name}
          label={name}
          leadingIcon={<Users size={13} />}
          onRemove={() => setCoAuthors((prev) => prev.filter((entry) => entry !== name))}
          removeLabel={`Remove ${name} as co-author`}
        />
      ))}
      {coAuthors.length === 0 && <Chip label="No co-authors" leadingIcon={<Tag size={13} />} />}
    </div>
  )
}
