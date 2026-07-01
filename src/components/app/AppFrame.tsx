import { useEffect, useState } from 'react'
import { AppShellBar } from '../AppShellBar'
import { GlobalTooltip } from '../GlobalTooltip'
import { RepositoryLoadingState } from '../EmptyState'
import { SignalStatus } from '../SignalStatus'
import { Toaster } from '../Toaster'
import { useController } from '../../hooks/AppControllerContext'
import {
  isRepositorySyncOperation,
  isRepositoryTransitionOperation,
  repositorySyncOperationLabel
} from '../../lib/repositoryOperationLabels'
import { AppDialogs } from './AppDialogs'
import { AppWorkspace, type ChangesTool } from './AppWorkspace'

const api = window.branchPilot

export function AppFrame() {
  const {
    snapshot,
    viewMode,
    busy,
    operationLabel,
    notice,
    error,
    setError,
    loadGitHubAccounts,
    loadGitHubRepositories,
    loadRepositoryDashboard
  } = useController()
  const [changesTool, setChangesTool] = useState<ChangesTool>(null)
  const [showClone, setShowClone] = useState(false)
  const [showPublishRepository, setShowPublishRepository] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const showRepositoryLoading = busy && isRepositoryTransitionOperation(operationLabel)
  const showRepositorySync = busy && !showRepositoryLoading && isRepositorySyncOperation(operationLabel)

  useEffect(() => {
    if (!api?.onMenuAction) return
    return api.onMenuAction((action) => {
      if (action === 'show-about') setShowAbout(true)
    })
  }, [])

  useEffect(() => {
    if (!showClone) return
    void loadGitHubAccounts()
    void loadGitHubRepositories()
  }, [showClone])

  useEffect(() => {
    if (showClone && snapshot) setShowClone(false)
  }, [showClone, snapshot?.summary.rootPath])

  useEffect(() => {
    if (viewMode === 'daily') void loadRepositoryDashboard()
  }, [viewMode, snapshot?.summary.rootPath])

  useEffect(() => {
    if (viewMode === 'review') setChangesTool('review')
  }, [viewMode])

  return (
    <main className="app-shell">
      <AppShellBar onOpenClone={() => setShowClone(true)} onOpenPublishRepository={() => setShowPublishRepository(true)} />
      <Toaster notice={notice} busy={busy} operationLabel={operationLabel} error={error} onDismissError={() => setError(null)} />
      <GlobalTooltip />
      {showRepositoryLoading && (
        <div className="repository-transition-overlay" role="presentation">
          <RepositoryLoadingState operationLabel={operationLabel} />
        </div>
      )}
      {showRepositorySync && (
        <div className="repository-refresh-curtain" role="presentation">
          <SignalStatus
            className="repository-refresh-signal"
            label={repositorySyncOperationLabel(operationLabel)}
            detail={snapshot?.summary.name ?? 'repository'}
          />
        </div>
      )}
      <AppWorkspace
        changesTool={changesTool}
        setChangesTool={setChangesTool}
        showRepositoryLoading={showRepositoryLoading}
        onOpenPublishRepository={() => setShowPublishRepository(true)}
      />
      <AppDialogs
        showClone={showClone}
        setShowClone={setShowClone}
        showPublishRepository={showPublishRepository}
        setShowPublishRepository={setShowPublishRepository}
        showAbout={showAbout}
        setShowAbout={setShowAbout}
      />
    </main>
  )
}
