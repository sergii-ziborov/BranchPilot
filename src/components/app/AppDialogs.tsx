import type { Dispatch, SetStateAction } from 'react'
import { AboutBranchPilotModal } from '../AboutBranchPilotModal'
import { ConfirmationDialog, TextPromptDialog } from '../Dialogs'
import { RepositoryPickerModal } from '../RepositoryPickerModal'
import { ToolModal } from '../ToolModal'
import { PublishRepositoryView } from '../views/PublishRepositoryView'
import { useController } from '../../hooks/AppControllerContext'
import { GitHubRepositoryBrowserHost } from './hosts/GitHubRepositoryBrowserHost'

const api = window.branchPilot

interface AppDialogsProps {
  showClone: boolean
  setShowClone: Dispatch<SetStateAction<boolean>>
  showPublishRepository: boolean
  setShowPublishRepository: Dispatch<SetStateAction<boolean>>
  showAbout: boolean
  setShowAbout: Dispatch<SetStateAction<boolean>>
}

export function AppDialogs({
  showClone,
  setShowClone,
  showPublishRepository,
  setShowPublishRepository,
  showAbout,
  setShowAbout
}: AppDialogsProps) {
  const {
    appVersion,
    snapshot,
    busy,
    selectedAssistant,
    assistantPolicy,
    confirmationRequest,
    answerConfirmation,
    textPromptRequest,
    textPromptValue,
    setTextPromptValue,
    answerTextPrompt,
    repositoryPickerOpen,
    setRepositoryPickerOpen,
    currentRepoPath,
    recentRepositories,
    openRepository,
    initializeRepository,
    cloneRemoteUrl,
    setCloneRemoteUrl,
    cloneTargetName,
    setCloneTargetName,
    cloneRepository,
    setNotice,
    setError,
    applySnapshot,
    setViewMode
  } = useController()

  return (
    <>
      {confirmationRequest && (
        <ConfirmationDialog request={confirmationRequest} onAnswer={answerConfirmation} />
      )}
      {textPromptRequest && (
        <TextPromptDialog
          request={textPromptRequest}
          value={textPromptValue}
          onChange={setTextPromptValue}
          onAnswer={answerTextPrompt}
        />
      )}
      {repositoryPickerOpen && (
        <RepositoryPickerModal
          api={api}
          busy={busy}
          currentRepoPath={currentRepoPath}
          recentRepositories={recentRepositories}
          openRepository={openRepository}
          initializeRepository={initializeRepository}
          onClose={() => setRepositoryPickerOpen(false)}
        />
      )}
      {showClone && (
        <ToolModal title="Clone repository" onClose={() => setShowClone(false)}>
          <section className="single-panel clone-modal-body">
            <form
              className="clone-url-row"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!cloneRemoteUrl.trim()) return
                await cloneRepository()
                setShowClone(false)
              }}
            >
              <input
                aria-label="Clone repository URL"
                value={cloneRemoteUrl}
                onChange={(event) => setCloneRemoteUrl(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                disabled={!api || busy}
                autoFocus
              />
              <input
                aria-label="Clone folder name"
                value={cloneTargetName}
                onChange={(event) => setCloneTargetName(event.target.value)}
                placeholder="Optional folder name"
                disabled={!api || busy}
              />
              <button type="submit" className="clone-url-button" disabled={!api || busy || !cloneRemoteUrl.trim()}>
                Clone URL
              </button>
            </form>
            <div className="clone-browse-label">Or pick one of your GitHub repositories</div>
            <GitHubRepositoryBrowserHost />
          </section>
        </ToolModal>
      )}
      {showPublishRepository && (
        <ToolModal title="Publish repository" className="publish-modal" onClose={() => setShowPublishRepository(false)}>
          <PublishRepositoryView
            api={api}
            snapshot={snapshot}
            selectedAssistant={selectedAssistant}
            assistantPolicy={assistantPolicy}
            setNotice={setNotice}
            setError={setError}
            onClose={() => setShowPublishRepository(false)}
            onPublished={(nextSnapshot, message) => {
              applySnapshot(nextSnapshot, message)
              setViewMode('changes')
            }}
          />
        </ToolModal>
      )}
      {showAbout && (
        <AboutBranchPilotModal appVersion={appVersion} onClose={() => setShowAbout(false)} />
      )}
    </>
  )
}
