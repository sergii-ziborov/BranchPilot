import { useState } from 'react'
import { Rows3, Columns2, UserRound, Building2 } from 'lucide-react'
import { SegmentedControl } from 'branchpilot'

export const IconOnlyDiffToggle = () => {
  const [mode, setMode] = useState('unified')
  return (
    <SegmentedControl
      ariaLabel="Diff display mode"
      className="diff-display-toggle"
      value={mode}
      onChange={setMode}
      options={[
        { value: 'unified', icon: <Rows3 size={16} />, title: 'Unified diff (single column)', ariaLabel: 'Unified diff' },
        { value: 'split', icon: <Columns2 size={16} />, title: 'Split diff (side by side)', ariaLabel: 'Split diff' }
      ]}
    />
  )
}

export const TextOwnerType = () => {
  const [owner, setOwner] = useState('user')
  return (
    <SegmentedControl
      ariaLabel="Owner type"
      value={owner}
      onChange={setOwner}
      options={[
        { value: 'user', label: 'User', icon: <UserRound size={15} /> },
        { value: 'organization', label: 'Organization', icon: <Building2 size={15} /> }
      ]}
    />
  )
}

export const PeriodSelector = () => {
  const [period, setPeriod] = useState('month')
  return (
    <SegmentedControl
      ariaLabel="Activity period"
      value={period}
      onChange={setPeriod}
      options={[
        { value: 'all', label: 'All' },
        { value: 'year', label: 'Year', disabled: true, title: 'Not enough history yet' },
        { value: 'month', label: 'Month' },
        { value: 'week', label: 'Week' }
      ]}
    />
  )
}

export const ReviewScope = () => {
  const [scope, setScope] = useState('staged')
  return (
    <SegmentedControl
      ariaLabel="Review scope"
      value={scope}
      onChange={setScope}
      options={[
        { value: 'selected', label: 'Selected file', disabled: true, title: 'Select a file in the diff to review it.' },
        { value: 'staged', label: 'Staged' },
        { value: 'unstaged', label: 'Unstaged' },
        { value: 'branch', label: 'Whole branch' }
      ]}
    />
  )
}
