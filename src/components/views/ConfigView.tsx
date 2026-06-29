import { useState } from 'react'
import { Bot, Code2, Database, FolderOpen, GitBranch, Loader2, Pencil, Plus, RefreshCcw, Save, Trash2, X } from 'lucide-react'
import { BranchPilotLogo } from '../BrandIcons'
import { BackToChanges } from '../BackToChanges'
import type { EditorPreference, TerminalPreference } from '../../shared/branchPilot'
import { useController } from '../../hooks/AppControllerContext'
import { WorktreesTagsPanel } from '../WorktreesTagsPanel'
import { SettingsTabs, type SettingsTab } from '../settings/SettingsTabs'
import { AssistantSettingsPanel } from '../settings/AssistantSettingsPanel'
import { gitDefaultBranchLabel, gitSigningLabel } from '../../lib/gitConfigLabels'
import {
  editorPreferenceCommandHint,
  editorPreferenceLabel,
  terminalPreferenceCommandHint,
  terminalPreferenceLabel
} from '../../lib/editorLabels'
import { gitLfsFileLabel, submoduleStatusLabel } from '../../lib/gitEntityLabels'
import { formatDate } from '../../lib/format'
import { InfoRow } from '../primitives'
import { SelectableChipGroup } from '../SelectableChipGroup'
import { assistantPolicyModes } from '../../lib/appOptions'

export function ConfigView({ onBack, editorPreferences, terminalPreferences }: {
  onBack: () => void
  editorPreferences: EditorPreference[]
  terminalPreferences: TerminalPreference[]
}) {
  const api = window.branchPilot
  const {
    appVersion, selectedAssistant, setSelectedAssistant, loadGitConfig, busy,
    assistants, assistantsChecking, checkAssistants, assistantPolicy, assistantPolicyLoading, updateAssistantPolicy,
    githubAccounts, githubAccountsLoading, githubCliStatus, loadGitHubAccounts,
    localUserName, setLocalUserName, localUserEmail, setLocalUserEmail, saveLocalGitIdentity,
    gitConfig, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand,
    saveEditorSettings, editorSettings, editorSettingsLoading,
    terminalPreference, setTerminalPreference, terminalCustomCommand, setTerminalCustomCommand,
    saveTerminalSettings, terminalSettings,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, saveRemote, editingRemoteName,
    cancelRemoteEdit, startRemoteEdit, removeRemote, snapshot,
    updateSubmodule, openSubmodule, runOperationAction, pullGitLfs,
    newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef,
    createWorktree, openWorktree, removeWorktree,
    tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage,
    createTag, deleteTag
  } = useController()
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('identity')
  const knownGitIdentityEmails = uniqueStrings([
    ...githubAccounts.filter((account) => account.type === 'user').flatMap((account) => account.emails ?? []),
    gitConfig?.localUserEmail ?? '',
    gitConfig?.effectiveUserEmail ?? '',
    gitConfig?.globalUserEmail ?? ''
  ])
  const hasGitHubEmailOptions = githubAccounts.some((account) => (account.emails ?? []).length > 0)
  const settingsTabCounts = {
    remotes: gitConfig?.remotes.length ?? 0,
    submodules: snapshot?.submodules.length ?? 0,
    worktrees: snapshot?.worktrees.length ?? 0,
    tags: snapshot?.tags.length ?? 0,
    lfsItems: (snapshot?.lfs.trackedPatterns.length ?? 0) + (snapshot?.lfs.files.length ?? 0)
  }

  return (
    <section className="single-panel">
      <div className="panel-heading settings-panel-heading">
        <div className="panel-heading-main">
          <BackToChanges onClick={onBack} />
          <div className="settings-heading-copy">
            <div className="settings-title-tabs">
              <h2>Settings</h2>
              <SettingsTabs activeTab={settingsTab} counts={settingsTabCounts} onChange={setSettingsTab} />
            </div>
          </div>
        </div>
        <button type="button" onClick={loadGitConfig} disabled={busy}>
          <RefreshCcw size={17} />
          Reload
        </button>
      </div>

      <div className="config-grid">
        {settingsTab === 'identity' && (
          <>
        <div className="config-card-stack identity-about-stack">
          <section className="config-card about-card">
          <div className="about-card-headline">
            <BranchPilotLogo size={30} />
            <span className="about-card-version">v{appVersion}</span>
          </div>
          <p className="about-tagline">A local-first desktop Git client — pilot your branches with confidence.</p>
          <p>BranchPilot manages local repositories and hosted providers: stage by hunk or line, review diffs with word-level highlighting, draft commit and pull-request text with an AI assistant, pull safely with auto-stash, and track work via reports — all read-only by default for assistants, with destructive actions gated behind explicit confirmations.</p>
          <div className="about-card-features">
            <span><GitBranch size={14} /> Branches, worktrees & tags</span>
            <span><Bot size={14} /> AI commit / PR / review drafts</span>
            <span><Database size={14} /> Git LFS & submodules</span>
          </div>
          </section>

          <section className="config-card git-settings-card">
            <h3>Git settings</h3>
            <InfoRow label="Global name" value={gitConfig?.globalUserName ?? 'Unset'} />
            <InfoRow label="Global email" value={gitConfig?.globalUserEmail ?? 'Unset'} />
            <InfoRow label="Default branch" value={gitDefaultBranchLabel(gitConfig)} />
            <InfoRow label="Commit signing" value={gitSigningLabel(gitConfig)} />
          </section>
        </div>

        <section className="config-card commit-identity-card">
          <div className="config-card-heading">
            <div>
              <h3>Commit identity</h3>
              <p>Name and email used for commits in <strong>this</strong> repository.</p>
            </div>
          </div>
          {gitConfig?.effectiveUserEmail && (
            <div className="config-commit-as">
              Commits as <strong>{gitConfig.effectiveUserName ?? 'Unknown'}</strong>
              <span>{gitConfig.effectiveUserEmail}</span>
            </div>
          )}
          <label htmlFor="local-user-name">Name</label>
          <input
            id="local-user-name"
            value={localUserName}
            onChange={(event) => setLocalUserName(event.target.value)}
            placeholder="Repository user.name"
          />
          <label htmlFor="local-user-email">Email</label>
          {knownGitIdentityEmails.length > 0 && (
            <SelectableChipGroup
              variant="config-email-options"
              ariaLabel="Known commit author emails"
              options={knownGitIdentityEmails}
              selected={knownGitIdentityEmails.find((email) => sameEmail(localUserEmail, email)) ?? ''}
              onSelect={setLocalUserEmail}
              inactiveClassName="secondary-button"
              disabled={busy}
              titleFor={(email) => `Use ${email} for commits in this repository`}
            />
          )}
          {githubCliStatus?.authenticated && !hasGitHubEmailOptions && (
            <button
              type="button"
              className="secondary-button config-email-load"
              onClick={() => void loadGitHubAccounts()}
              disabled={busy || githubAccountsLoading}
              title="Load email addresses from your authenticated GitHub account"
            >
              {githubAccountsLoading ? <Loader2 className="spin" size={15} /> : null}
              {githubAccountsLoading ? 'Loading GitHub emails' : 'Load GitHub emails'}
            </button>
          )}
          <input
            id="local-user-email"
            list="known-emails"
            value={localUserEmail}
            onChange={(event) => setLocalUserEmail(event.target.value)}
            placeholder="Repository user.email"
          />
          <datalist id="known-emails">
            {knownGitIdentityEmails
              .map((email) => (
                <option key={email} value={email} />
              ))}
          </datalist>
          <div className="config-identity-actions">
            <button type="button" onClick={saveLocalGitIdentity} disabled={busy || !localUserName.trim() || !localUserEmail.trim()}>
              <Save size={17} />
              Save commit identity
            </button>
            {gitConfig?.globalUserEmail && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setLocalUserName(gitConfig.globalUserName ?? '')
                  setLocalUserEmail(gitConfig.globalUserEmail ?? '')
                }}
                disabled={busy}
                title={`Use ${gitConfig.globalUserEmail}`}
              >
                Use global
              </button>
            )}
          </div>
        </section>

        <section className="config-card editor-settings-card">
          <h3>Editor</h3>
          <label htmlFor="editor-preference">Default editor</label>
          <select
            id="editor-preference"
            value={editorPreference}
            onChange={(event) => setEditorPreference(event.target.value as EditorPreference)}
            disabled={editorSettingsLoading || busy}
          >
            {editorPreferences.map((preference) => (
              <option value={preference} key={preference}>
                {editorPreferenceLabel(preference)}
              </option>
            ))}
          </select>
          <label htmlFor="editor-custom-command">Custom command</label>
          <input
            id="editor-custom-command"
            value={editorPreference === 'custom' ? editorCustomCommand : editorPreferenceCommandHint(editorPreference)}
            onChange={(event) => setEditorCustomCommand(event.target.value)}
            placeholder={editorPreferenceCommandHint(editorPreference) || 'code --goto %TARGET_PATH%'}
            disabled={editorPreference !== 'custom' || editorSettingsLoading || busy}
          />
          <p className="muted-text">
            BranchPilot also checks standard install locations on Windows, macOS, and Linux. Use <code>%TARGET_PATH%</code> only for custom commands.
          </p>
          <button
            type="button"
            onClick={saveEditorSettings}
            disabled={editorSettingsLoading || busy || (editorPreference === 'custom' && !editorCustomCommand.trim())}
          >
            <Save size={17} />
            Save editor settings
          </button>
          {editorSettings?.updatedAt && (
            <p className="muted-text">Updated {formatDate(editorSettings.updatedAt)}</p>
          )}
        </section>

        <section className="config-card terminal-settings-card">
          <h3>Terminal</h3>
          <label htmlFor="terminal-preference">Default terminal</label>
          <select
            id="terminal-preference"
            value={terminalPreference}
            onChange={(event) => setTerminalPreference(event.target.value as TerminalPreference)}
            disabled={editorSettingsLoading || busy}
          >
            {terminalPreferences.map((preference) => (
              <option value={preference} key={preference}>
                {terminalPreferenceLabel(preference)}
              </option>
            ))}
          </select>
          <label htmlFor="terminal-custom-command">Custom command</label>
          <input
            id="terminal-custom-command"
            value={terminalPreference === 'custom' ? terminalCustomCommand : terminalPreferenceCommandHint(terminalPreference)}
            onChange={(event) => setTerminalCustomCommand(event.target.value)}
            placeholder={terminalPreferenceCommandHint(terminalPreference) || 'wt.exe -d %TARGET_PATH%'}
            disabled={terminalPreference !== 'custom' || editorSettingsLoading || busy}
          />
          <p className="muted-text">
            BranchPilot opens the selected terminal in the repository or file folder. Use <code>%TARGET_PATH%</code> only for custom commands.
          </p>
          <button
            type="button"
            onClick={saveTerminalSettings}
            disabled={editorSettingsLoading || busy || (terminalPreference === 'custom' && !terminalCustomCommand.trim())}
          >
            <Save size={17} />
            Save terminal settings
          </button>
          {terminalSettings?.updatedAt && (
            <p className="muted-text">Updated {formatDate(terminalSettings.updatedAt)}</p>
          )}
        </section>
          </>
        )}

        {settingsTab === 'assistant' && (
          <AssistantSettingsPanel
            selectedAssistant={selectedAssistant}
            setSelectedAssistant={setSelectedAssistant}
            assistants={assistants}
            assistantsChecking={assistantsChecking}
            checkAssistants={checkAssistants}
            assistantPolicy={assistantPolicy}
            assistantPolicyLoading={assistantPolicyLoading}
            assistantPolicyModes={assistantPolicyModes}
            snapshot={snapshot}
            updateAssistantPolicy={updateAssistantPolicy}
          />
        )}

        {settingsTab === 'remotes' && (
        <section className="config-card remotes-card">
          <div className="config-card-heading">
            <div>
              <h3>Remotes</h3>
              <p>Add, update, or remove repository remotes.</p>
            </div>
          </div>
          <div className="remote-composer">
            <label htmlFor="remote-name">
              Name
              <input
                id="remote-name"
                value={remoteName}
                onChange={(event) => setRemoteName(event.target.value)}
                placeholder="origin"
                disabled={busy || Boolean(editingRemoteName)}
              />
            </label>
            <label htmlFor="remote-url">
              URL
              <input
                id="remote-url"
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                disabled={busy}
              />
            </label>
            <button type="button" onClick={saveRemote} disabled={busy || !remoteName.trim() || !remoteUrl.trim()}>
              {editingRemoteName ? <Save size={16} /> : <Plus size={16} />}
              {editingRemoteName ? 'Save' : 'Add'}
            </button>
            {editingRemoteName && (
              <button className="secondary-button" type="button" onClick={cancelRemoteEdit} disabled={busy}>
                <X size={16} />
                Cancel
              </button>
            )}
          </div>
          {gitConfig?.remotes.length === 0 || !gitConfig ? (
            <p className="muted-text">No remotes configured.</p>
          ) : (
            gitConfig.remotes.map((remote) => (
              <div className="remote-row" key={remote.name}>
                <div className="remote-row-details">
                  <strong>{remote.name}</strong>
                  <span>fetch: {remote.fetchUrl ?? 'unset'}</span>
                  <span>push: {remote.pushUrl ?? 'unset'}</span>
                </div>
                <div className="remote-row-actions">
                  <button className="secondary-button icon-button" type="button" title="Edit remote" aria-label="Edit remote" onClick={() => startRemoteEdit(remote)} disabled={busy}>
                    <Pencil size={16} />
                  </button>
                  <button className="danger-button icon-button" type="button" title="Remove remote" aria-label="Remove remote" onClick={() => removeRemote(remote)} disabled={busy}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
        )}

        {settingsTab === 'submodules' && (
        <section className="config-card submodules-card">
          <div className="config-card-heading">
            <div>
              <h3>Submodules</h3>
              <p>Initialize and update configured Git submodules.</p>
            </div>
            <button type="button" onClick={() => updateSubmodule()} disabled={busy || !snapshot?.submodules.length}>
              <RefreshCcw size={16} />
              Update all
            </button>
          </div>
          {!snapshot?.submodules.length ? (
            <p className="muted-text">No submodules configured.</p>
          ) : (
            <div className="submodule-list">
              {snapshot.submodules.map((submodule) => (
                <article className={`submodule-row status-${submodule.status}`} key={submodule.path}>
                  <div>
                    <strong>{submodule.path}</strong>
                    <span>{submoduleStatusLabel(submodule)}</span>
                    <code>{submodule.url ?? 'No URL configured'}</code>
                    {submodule.branch && <span>branch: {submodule.branch}</span>}
                  </div>
                  <div className="panel-actions">
                    <button className="icon-button" type="button" title={submodule.status === 'uninitialized' ? 'Initialize submodule' : 'Update submodule'} aria-label={submodule.status === 'uninitialized' ? 'Initialize submodule' : 'Update submodule'} onClick={() => updateSubmodule(submodule)} disabled={busy}>
                      <RefreshCcw size={16} />
                    </button>
                    <button className="icon-button" type="button" title="Open submodule" aria-label="Open submodule" onClick={() => openSubmodule(submodule)} disabled={busy || submodule.status === 'uninitialized'}>
                      <FolderOpen size={16} />
                    </button>
                    <button className="icon-button" type="button" title="Open in editor" aria-label="Open in editor" onClick={() => runOperationAction('Submodule opened in editor.', () => api!.openInEditor({ targetPath: submodule.absolutePath }))} disabled={busy || submodule.status === 'uninitialized'}>
                      <Code2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        )}

        {settingsTab === 'lfs' && (
        <section className="config-card lfs-card">
          <div className="config-card-heading">
            <div>
              <h3>Git LFS</h3>
              <p>{snapshot?.lfs.message ?? 'Open a repository to inspect Git LFS.'}</p>
            </div>
            <button type="button" onClick={pullGitLfs} disabled={busy || !snapshot?.lfs.installed}>
              <Database size={16} />
              Pull LFS
            </button>
          </div>

          <div className="lfs-summary-grid">
            <InfoRow label="Installed" value={snapshot?.lfs.installed ? 'Yes' : 'No'} />
            <InfoRow label="Version" value={snapshot?.lfs.version ?? 'Unavailable'} />
            <InfoRow label="Patterns" value={String(snapshot?.lfs.trackedPatterns.length ?? 0)} />
            <InfoRow label="Known files" value={String(snapshot?.lfs.fileCount ?? 0)} />
          </div>

          <div className="lfs-columns">
            <section>
              <h4>Tracked patterns</h4>
              {!snapshot?.lfs.trackedPatterns.length ? (
                <p className="muted-text">No LFS patterns found in tracked .gitattributes files.</p>
              ) : (
                <div className="lfs-list">
                  {snapshot.lfs.trackedPatterns.map((pattern) => (
                    <div className="lfs-row" key={`${pattern.sourcePath}-${pattern.line}-${pattern.pattern}`}>
                      <strong>{pattern.pattern}</strong>
                      <span>{pattern.sourcePath}:{pattern.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4>LFS files</h4>
              {!snapshot?.lfs.files.length ? (
                <p className="muted-text">{snapshot?.lfs.installed ? 'No LFS files reported by git lfs.' : 'Install git-lfs to list LFS files.'}</p>
              ) : (
                <div className="lfs-list">
                  {snapshot.lfs.files.map((file) => (
                    <div className="lfs-row" key={`${file.oid ?? file.status}-${file.path}`}>
                      <strong>{file.path}</strong>
                      <span>{gitLfsFileLabel(file.status, file.oid)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
        )}

        {(settingsTab === 'worktrees' || settingsTab === 'tags') && (
          <WorktreesTagsPanel
            snapshot={snapshot}
            api={api}
            busy={busy}
            runOperationAction={runOperationAction}
            newWorktreeBranchName={newWorktreeBranchName}
            setNewWorktreeBranchName={setNewWorktreeBranchName}
            newWorktreeBaseRef={newWorktreeBaseRef}
            setNewWorktreeBaseRef={setNewWorktreeBaseRef}
            createWorktree={createWorktree}
            openWorktree={openWorktree}
            removeWorktree={removeWorktree}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            newTagName={newTagName}
            setNewTagName={setNewTagName}
            newTagMessage={newTagMessage}
            setNewTagMessage={setNewTagMessage}
            createTag={createTag}
            deleteTag={deleteTag}
            panel={settingsTab}
          />
        )}
      </div>
    </section>
  )
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    const key = trimmed.toLowerCase()

    if (trimmed && !seen.has(key)) {
      seen.add(key)
      unique.push(trimmed)
    }
  }

  return unique
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
