import { useEffect, useRef } from 'react'
import { Check, RefreshCw, Settings } from 'lucide-react'
import { commitIdentityAvatarUrl } from '../../lib/commitIdentity'
import { CommitIdentityAvatar } from '../CommitIdentityAvatar'
import type { ViewMode } from '../../lib/viewMode'
import type { CommitIdentityState } from './useCommitIdentityState'

export interface CommitIdentityMenuProps {
  identityState: CommitIdentityState
  busy: boolean
  setViewMode: (mode: ViewMode) => void
}

export function CommitIdentityMenu({ identityState, busy, setViewMode }: CommitIdentityMenuProps) {
  const {
    commitIdentityOptions,
    selectedCommitIdentityKey,
    selectedCommitIdentityName,
    selectedCommitIdentityEmailText,
    selectedCommitIdentityAvatar,
    githubIdentityLabel,
    commitIdentitySaving,
    commitIdentityAccountsLoading,
    loadCommitIdentityAccounts,
    selectCommitIdentity
  } = identityState
  const commitIdentityMenuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const identityMenu = commitIdentityMenuRef.current
      if (identityMenu?.open && event.target instanceof Node && !identityMenu.contains(event.target)) {
        identityMenu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  return (
    <details
      className="commit-identity-menu"
      ref={commitIdentityMenuRef}
      onToggle={(event) => {
        if (event.currentTarget.open) void loadCommitIdentityAccounts(false)
      }}
    >
      <summary
        title={`Committing as ${selectedCommitIdentityName} <${selectedCommitIdentityEmailText}>`}
        aria-label={`Committing as ${selectedCommitIdentityName}`}
      >
        <CommitIdentityAvatar avatarUrl={selectedCommitIdentityAvatar} />
      </summary>
      <div className="commit-identity-popover">
        <div className="commit-identity-current">
          <CommitIdentityAvatar avatarUrl={selectedCommitIdentityAvatar} large />
          <div>
            <strong>Committing as {selectedCommitIdentityName}</strong>
            <span>Email: {selectedCommitIdentityEmailText}</span>
            <small>{githubIdentityLabel}</small>
          </div>
        </div>
        <div className="commit-identity-options" aria-label="Commit author identities">
          {commitIdentityOptions.length > 0 ? commitIdentityOptions.map((identity) => {
            const selected = identity.email.toLowerCase() === selectedCommitIdentityKey
            const avatarUrl = commitIdentityAvatarUrl(identity)

            return (
              <button
                type="button"
                key={identity.email}
                className={selected ? 'commit-identity-option active' : 'commit-identity-option'}
                title={`Use ${identity.name} <${identity.email}> for the next commits in this repository. Source: ${identity.meta}.`}
                aria-pressed={selected}
                disabled={busy || commitIdentitySaving}
                onClick={() => {
                  void selectCommitIdentity(identity).then((saved) => {
                    if (saved && commitIdentityMenuRef.current) commitIdentityMenuRef.current.open = false
                  })
                }}
              >
                <CommitIdentityAvatar avatarUrl={avatarUrl} />
                <span>
                  <strong>{identity.name}</strong>
                  <small>{identity.email}</small>
                </span>
                {selected && <Check size={14} />}
              </button>
            )
          }) : (
            <div className="commit-identity-empty">No commit identity configured yet.</div>
          )}
        </div>
        <div className="commit-identity-actions">
          <button type="button" onClick={() => {
            if (commitIdentityMenuRef.current) commitIdentityMenuRef.current.open = false
            setViewMode('config')
          }}>
            <Settings size={15} />
            Open git settings
          </button>
          <button
            type="button"
            className="secondary"
            title="Refresh cached GitHub accounts and emails"
            disabled={commitIdentityAccountsLoading}
            onClick={() => { void loadCommitIdentityAccounts(true) }}
          >
            <RefreshCw className={commitIdentityAccountsLoading ? 'spin' : undefined} size={15} />
            Refresh
          </button>
        </div>
      </div>
    </details>
  )
}
