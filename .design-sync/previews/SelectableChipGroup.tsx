import { useState } from 'react'
import { SelectableChipGroup } from 'branchpilot'

export const NameSuggestions = () => {
  const [name, setName] = useState('branch-pilot')
  return (
    <SelectableChipGroup
      options={['branch-pilot', 'branchpilot-app', 'branchpilot-desktop', 'git-branch-pilot']}
      selected={name}
      onSelect={setName}
      variant="name-suggestions"
      ariaLabel="Repository name suggestions"
    />
  )
}

export const EmailOptions = () => {
  const [email, setEmail] = useState('sergii.ziborov@gmail.com')
  return (
    <SelectableChipGroup
      options={['sergii.ziborov@gmail.com', '12345678+szib@users.noreply.github.com', 'serhii@work.example.com']}
      selected={email}
      onSelect={setEmail}
      variant="email-options"
      ariaLabel="Known GitHub and Git config emails"
      titleFor={(opt) => `Use ${opt} as the starter commit author`}
    />
  )
}

export const ConfigEmailOptions = () => {
  const [email, setEmail] = useState('serhii@work.example.com')
  return (
    <SelectableChipGroup
      options={['serhii@work.example.com', 'sergii.ziborov@gmail.com', '12345678+szib@users.noreply.github.com']}
      selected={email}
      onSelect={setEmail}
      variant="config-email-options"
      ariaLabel="Known commit author emails"
      inactiveClassName="secondary-button"
      titleFor={(opt) => `Use ${opt} for commits in this repository`}
    />
  )
}
