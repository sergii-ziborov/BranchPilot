import { useState } from 'react'
import { EmptyState } from 'branchpilot'

const noop = () => {}

export const Ready = () => {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  return (
    <EmptyState
      apiReady
      busy={false}
      chooseRepository={noop}
      cloneRemoteUrl={url}
      setCloneRemoteUrl={setUrl}
      cloneTargetName={name}
      setCloneTargetName={setName}
      cloneRepository={noop}
    />
  )
}

export const Cloning = () => {
  const [url, setUrl] = useState('https://github.com/branchpilot/branchpilot.git')
  const [name, setName] = useState('branchpilot')
  return (
    <EmptyState
      apiReady
      busy
      chooseRepository={noop}
      cloneRemoteUrl={url}
      setCloneRemoteUrl={setUrl}
      cloneTargetName={name}
      setCloneTargetName={setName}
      cloneRepository={noop}
    />
  )
}
