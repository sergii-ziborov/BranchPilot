import { Code2, Database, FolderOpen, Pencil, Plus, RefreshCcw, Save, Trash2, X } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, EditorPreference, EditorSettings, GitConfigSnapshot,
  GitOperationResult, RemoteSummary, RepositorySnapshot, SubmoduleSummary
} from '../../shared/branchPilot'
import { gitDefaultBranchLabel, gitSigningLabel } from '../../lib/gitConfigLabels'
import { editorPreferenceLabel } from '../../lib/editorLabels'
import { gitLfsFileLabel, submoduleStatusLabel } from '../../lib/gitEntityLabels'
import { formatDate } from '../../lib/format'
import { InfoRow } from '../primitives'

export function ConfigView({
  loadGitConfig,
  busy,
  localUserName,
  setLocalUserName,
  localUserEmail,
  setLocalUserEmail,
  saveLocalGitIdentity,
  gitConfig,
  editorPreference,
  setEditorPreference,
  editorPreferences,
  editorCustomCommand,
  setEditorCustomCommand,
  saveEditorSettings,
  editorSettings,
  editorSettingsLoading,
  remoteName,
  setRemoteName,
  remoteUrl,
  setRemoteUrl,
  saveRemote,
  editingRemoteName,
  cancelRemoteEdit,
  startRemoteEdit,
  removeRemote,
  snapshot,
  updateSubmodule,
  openSubmodule,
  runOperationAction,
  api,
  pullGitLfs
}: {
  loadGitConfig: () => void | Promise<void>
  busy: boolean
  localUserName: string
  setLocalUserName: (value: string) => void
  localUserEmail: string
  setLocalUserEmail: (value: string) => void
  saveLocalGitIdentity: () => void | Promise<void>
  gitConfig: GitConfigSnapshot | null
  editorPreference: EditorPreference
  setEditorPreference: (preference: EditorPreference) => void
  editorPreferences: EditorPreference[]
  editorCustomCommand: string
  setEditorCustomCommand: (value: string) => void
  saveEditorSettings: () => void | Promise<void>
  editorSettings: EditorSettings | null
  editorSettingsLoading: boolean
  remoteName: string
  setRemoteName: (value: string) => void
  remoteUrl: string
  setRemoteUrl: (value: string) => void
  saveRemote: () => void | Promise<void>
  editingRemoteName: string | null
  cancelRemoteEdit: () => void
  startRemoteEdit: (remote: RemoteSummary) => void
  removeRemote: (remote: RemoteSummary) => void | Promise<void>
  snapshot: RepositorySnapshot | null
  updateSubmodule: (submodule?: SubmoduleSummary) => void | Promise<void>
  openSubmodule: (submodule: SubmoduleSummary) => void | Promise<void>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>) => void | Promise<void>
  api: BranchPilotApi | undefined
  pullGitLfs: () => void | Promise<void>
}) {
    return (
    <section className="single-panel">
      <div className="panel-heading">
        <div>
          <h2>Git Config</h2>
          <p>Inspect effective Git identity and update repository-local commit identity.</p>
        </div>
        <button type="button" onClick={loadGitConfig} disabled={busy}>
          <RefreshCcw size={17} />
          Reload
        </button>
      </div>

      <div className="config-grid">
        <section className="config-card">
          <h3>Local identity</h3>
          <label htmlFor="local-user-name">Name</label>
          <input
            id="local-user-name"
            value={localUserName}
            onChange={(event) => setLocalUserName(event.target.value)}
            placeholder="Repository user.name"
          />
          <label htmlFor="local-user-email">Email</label>
          <input
            id="local-user-email"
            value={localUserEmail}
            onChange={(event) => setLocalUserEmail(event.target.value)}
            placeholder="Repository user.email"
          />
          <button type="button" onClick={saveLocalGitIdentity} disabled={busy || !localUserName.trim() || !localUserEmail.trim()}>
            <Save size={17} />
            Save local identity
          </button>
        </section>

        <section className="config-card">
          <h3>Effective identity</h3>
          <InfoRow label="Name" value={gitConfig?.effectiveUserName ?? 'Unset'} />
          <InfoRow label="Email" value={gitConfig?.effectiveUserEmail ?? 'Unset'} />
          <InfoRow label="Global name" value={gitConfig?.globalUserName ?? 'Unset'} />
          <InfoRow label="Global email" value={gitConfig?.globalUserEmail ?? 'Unset'} />
          <InfoRow label="Default branch" value={gitDefaultBranchLabel(gitConfig)} />
          <InfoRow label="Commit signing" value={gitSigningLabel(gitConfig)} />
        </section>

        <section className="config-card">
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
            value={editorCustomCommand}
            onChange={(event) => setEditorCustomCommand(event.target.value)}
            placeholder="code --goto %TARGET_PATH%"
            disabled={editorPreference !== 'custom' || editorSettingsLoading || busy}
          />
          <p className="muted-text">Use <code>%TARGET_PATH%</code> where BranchPilot should place the repository or file path.</p>
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
                  <button className="secondary-button" type="button" onClick={() => startRemoteEdit(remote)} disabled={busy}>
                    <Pencil size={16} />
                    Edit
                  </button>
                  <button className="danger-button" type="button" onClick={() => removeRemote(remote)} disabled={busy}>
                    <Trash2 size={16} />
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

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
                    <button type="button" onClick={() => updateSubmodule(submodule)} disabled={busy}>
                      <RefreshCcw size={16} />
                      {submodule.status === 'uninitialized' ? 'Init' : 'Update'}
                    </button>
                    <button type="button" onClick={() => openSubmodule(submodule)} disabled={busy || submodule.status === 'uninitialized'}>
                      <FolderOpen size={16} />
                      Open
                    </button>
                    <button type="button" onClick={() => runOperationAction('Submodule opened in editor.', () => api!.openInEditor({ targetPath: submodule.absolutePath }))} disabled={busy || submodule.status === 'uninitialized'}>
                      <Code2 size={16} />
                      Editor
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

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
      </div>
    </section>
  )
}
