import { useState } from 'react'
import type {
  ApiResult, BranchPilotApi, EditorPreference, EditorSettings, GitBackendPreference, GitBackendSettings,
  GitConfigSnapshot, GitMonitorSettings, GitMonitorSettingsUpdate, RemoteSummary, RepositorySnapshot,
  TerminalPreference, TerminalSettings
} from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { editorPreferenceLabel, gitBackendPreferenceLabel, terminalPreferenceLabel } from '../lib/editorLabels'
import type { RequestConfirmation } from '../lib/prompts'

/** Owns Git identity, editor settings, and remote management state + handlers. */
export function useGitConfig({
  api,
  currentRepoPath,
  setNotice,
  setError,
  runBusyOperation,
  runApiAction,
  requestConfirmation,
  applySnapshotResult
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  requestConfirmation: RequestConfirmation
  applySnapshotResult: (result: ApiResult<RepositorySnapshot>, successMessage: string) => void
}) {
  const [gitConfig, setGitConfig] = useState<GitConfigSnapshot | null>(null)
  const [editorSettings, setEditorSettings] = useState<EditorSettings | null>(null)
  const [editorPreference, setEditorPreference] = useState<EditorPreference>('vscode')
  const [editorCustomCommand, setEditorCustomCommand] = useState('')
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings | null>(null)
  const [terminalPreference, setTerminalPreference] = useState<TerminalPreference>('auto')
  const [terminalCustomCommand, setTerminalCustomCommand] = useState('')
  const [gitBackendSettings, setGitBackendSettings] = useState<GitBackendSettings | null>(null)
  const [gitBackendPreference, setGitBackendPreference] = useState<GitBackendPreference>('console')
  const [gitMonitorSettings, setGitMonitorSettings] = useState<GitMonitorSettings | null>(null)
  const [editorSettingsLoading, setEditorSettingsLoading] = useState(false)
  const [localUserName, setLocalUserName] = useState('')
  const [localUserEmail, setLocalUserEmail] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [editingRemoteName, setEditingRemoteName] = useState<string | null>(null)

  async function loadEditorSettings() {
    if (!api) return
    setEditorSettingsLoading(true)
    const [editorResult, terminalResult, gitBackendResult, gitMonitorResult] = await Promise.all([
      api.getEditorSettings(),
      api.getTerminalSettings(),
      api.getGitBackendSettings(),
      api.getGitMonitorSettings()
    ])

    if (editorResult.ok) {
      setEditorSettings(editorResult.data)
      setEditorPreference(editorResult.data.preference)
      setEditorCustomCommand(editorResult.data.customCommand ?? '')
    } else {
      setError(editorResult.error.message)
      setNotice(branchPilotErrorText(editorResult.error))
    }

    if (terminalResult.ok) {
      setTerminalSettings(terminalResult.data)
      setTerminalPreference(terminalResult.data.preference)
      setTerminalCustomCommand(terminalResult.data.customCommand ?? '')
    } else {
      setError(terminalResult.error.message)
      setNotice(branchPilotErrorText(terminalResult.error))
    }

    if (gitBackendResult.ok) {
      setGitBackendSettings(gitBackendResult.data)
      setGitBackendPreference(gitBackendResult.data.preference)
    } else {
      setError(gitBackendResult.error.message)
      setNotice(branchPilotErrorText(gitBackendResult.error))
    }

    if (gitMonitorResult.ok) {
      setGitMonitorSettings(gitMonitorResult.data)
    } else {
      setError(gitMonitorResult.error.message)
      setNotice(branchPilotErrorText(gitMonitorResult.error))
    }

    setEditorSettingsLoading(false)
  }

  // PR-notification monitor settings persist immediately on each toggle/interval
  // change. Merge the partial update onto current state optimistically.
  async function saveGitMonitorSettings(update: GitMonitorSettingsUpdate) {
    if (!api) return
    setGitMonitorSettings((current) => (current ? { ...current, ...update } : current))
    setError(null)
    const result = await api.setGitMonitorSettings(update)

    if (result.ok) {
      setGitMonitorSettings(result.data)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }
  }

  // Git backend persists immediately on change (no separate save button). Update
  // the selection optimistically so the segmented control reacts without waiting.
  async function saveGitBackendSettings(preference: GitBackendPreference) {
    if (!api) return
    setGitBackendPreference(preference)
    setEditorSettingsLoading(true)
    setError(null)
    const result = await api.setGitBackendSettings({ preference })

    if (result.ok) {
      setGitBackendSettings(result.data)
      setGitBackendPreference(result.data.preference)
      setNotice(`Git backend set to ${gitBackendPreferenceLabel(result.data.preference)}.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setEditorSettingsLoading(false)
  }

  async function saveEditorSettings() {
    if (!api) return
    setEditorSettingsLoading(true)
    setError(null)
    const result = await api.setEditorSettings({
      preference: editorPreference,
      customCommand: editorPreference === 'custom' ? editorCustomCommand.trim() : undefined
    })

    if (result.ok) {
      setEditorSettings(result.data)
      setEditorPreference(result.data.preference)
      setEditorCustomCommand(result.data.customCommand ?? '')
      setNotice(`Default editor set to ${editorPreferenceLabel(result.data.preference)}.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setEditorSettingsLoading(false)
  }

  async function saveTerminalSettings() {
    if (!api) return
    setEditorSettingsLoading(true)
    setError(null)
    const result = await api.setTerminalSettings({
      preference: terminalPreference,
      customCommand: terminalPreference === 'custom' ? terminalCustomCommand.trim() : undefined
    })

    if (result.ok) {
      setTerminalSettings(result.data)
      setTerminalPreference(result.data.preference)
      setTerminalCustomCommand(result.data.customCommand ?? '')
      setNotice(`Default terminal set to ${terminalPreferenceLabel(result.data.preference)}.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setEditorSettingsLoading(false)
  }

  async function loadGitConfig() {
    if (!api || !currentRepoPath) return
    const result = await api.getGitConfig(currentRepoPath)

    if (result.ok) {
      setGitConfig(result.data)
      setLocalUserName(result.data.localUserName ?? result.data.globalUserName ?? '')
      setLocalUserEmail(result.data.localUserEmail ?? result.data.globalUserEmail ?? '')
    } else {
      setError(result.error.message)
    }
  }

  async function saveLocalGitIdentity() {
    if (!api || !currentRepoPath) return
    await runBusyOperation('Saving Git identity...', async () => {
      const result = await api.setLocalGitIdentity({
        repoPath: currentRepoPath,
        name: localUserName.trim(),
        email: localUserEmail.trim()
      })

      if (result.ok) {
        setGitConfig(result.data)
        setNotice('Local Git identity saved.')
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  function startRemoteEdit(remote: RemoteSummary) {
    setEditingRemoteName(remote.name)
    setRemoteName(remote.name)
    setRemoteUrl(remote.fetchUrl ?? remote.pushUrl ?? '')
  }

  function cancelRemoteEdit() {
    setEditingRemoteName(null)
    setRemoteName('')
    setRemoteUrl('')
  }

  async function saveRemote() {
    if (!api || !currentRepoPath) return

    const name = (editingRemoteName ?? remoteName).trim()
    const url = remoteUrl.trim()

    if (!name || !url) {
      setNotice('Remote blocked: add a name and URL.')
      return
    }

    const label = editingRemoteName ? 'Remote updated.' : 'Remote added.'

    await runApiAction(
      editingRemoteName ? 'Updating remote...' : 'Adding remote...',
      () => editingRemoteName
        ? api.setRemoteUrl({ repoPath: currentRepoPath, name, url })
        : api.addRemote({ repoPath: currentRepoPath, name, url }),
      async (data) => {
        setGitConfig(data)
        cancelRemoteEdit()
        const snapshotResult = await api.refreshRepository(currentRepoPath)
        applySnapshotResult(snapshotResult, label)
        if (!snapshotResult.ok) {
          setNotice(label)
        }
      }
    )
  }

  async function removeRemote(remote: RemoteSummary) {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation(`Remove remote ${remote.name}?`, {
      title: 'Remove Remote',
      confirmLabel: 'Remove remote',
      variant: 'danger'
    })

    if (!confirmed) return

    await runApiAction('Removing remote...', () => api.removeRemote({
      repoPath: currentRepoPath,
      name: remote.name,
      confirmed
    }), async (data) => {
      setGitConfig(data)
      if (editingRemoteName === remote.name) {
        cancelRemoteEdit()
      }
      const snapshotResult = await api.refreshRepository(currentRepoPath)
      applySnapshotResult(snapshotResult, 'Remote removed.')
      if (!snapshotResult.ok) {
        setNotice('Remote removed.')
      }
    })
  }

  return {
    gitConfig, setGitConfig,
    editorSettings, editorPreference, setEditorPreference,
    editorCustomCommand, setEditorCustomCommand, editorSettingsLoading,
    terminalSettings, terminalPreference, setTerminalPreference,
    terminalCustomCommand, setTerminalCustomCommand, saveTerminalSettings,
    gitBackendSettings, gitBackendPreference, saveGitBackendSettings,
    gitMonitorSettings, saveGitMonitorSettings,
    localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName,
    loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity,
    startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote
  }
}
