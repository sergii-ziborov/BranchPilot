import { useState } from 'react'
import { ViewSwitch } from 'branchpilot'

export const ChangesActive = () => {
  const [mode, setMode] = useState('changes')
  return <ViewSwitch viewMode={mode} setViewMode={setMode} changedCount={4} />
}

export const HistoryActive = () => {
  const [mode, setMode] = useState('history')
  return <ViewSwitch viewMode={mode} setViewMode={setMode} changedCount={0} />
}
