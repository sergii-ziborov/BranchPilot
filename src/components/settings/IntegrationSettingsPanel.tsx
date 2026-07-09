import { Save } from 'lucide-react'
import type { EditorPreference, GitBackendPreference, TerminalPreference } from '../../shared/branchPilot'
import { useController } from '../../hooks/AppControllerContext'
import {
  editorPreferenceCommandHint,
  editorPreferenceLabel,
  gitBackendPreferenceDescription,
  gitBackendPreferenceLabel,
  terminalPreferenceCommandHint,
  terminalPreferenceLabel
} from '../../lib/editorLabels'
import { formatDate } from '../../lib/format'

/**
 * Editor, terminal, and Git-backend cards for the identity settings tab. Extracted
 * from ConfigView so each file stays under the size limit. Editor/terminal keep the
 * explicit save button; the Git backend persists immediately on selection.
 */
export function IntegrationSettingsPanel({ editorPreferences, terminalPreferences, gitBackendPreferences }: {
  editorPreferences: EditorPreference[]
  terminalPreferences: TerminalPreference[]
  gitBackendPreferences: GitBackendPreference[]
}) {
  const {
    busy,
    editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand,
    saveEditorSettings, editorSettings, editorSettingsLoading,
    terminalPreference, setTerminalPreference, terminalCustomCommand, setTerminalCustomCommand,
    saveTerminalSettings, terminalSettings,
    gitBackendSettings, gitBackendPreference, saveGitBackendSettings,
    gitMonitorSettings, saveGitMonitorSettings
  } = useController()

  const monitorEnabled = gitMonitorSettings?.enabled ?? false
  const monitorDisabled = !gitMonitorSettings || editorSettingsLoading || busy

  return (
    <>
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
        <div className="config-save-row">
          <button
            type="button"
            onClick={saveEditorSettings}
            disabled={editorSettingsLoading || busy || (editorPreference === 'custom' && !editorCustomCommand.trim())}
          >
            <Save size={17} />
            Save editor settings
          </button>
          {editorSettings?.updatedAt && (
            <span className="config-updated-note">Updated {formatDate(editorSettings.updatedAt)}</span>
          )}
        </div>
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
        <div className="config-save-row">
          <button
            type="button"
            onClick={saveTerminalSettings}
            disabled={editorSettingsLoading || busy || (terminalPreference === 'custom' && !terminalCustomCommand.trim())}
          >
            <Save size={17} />
            Save terminal settings
          </button>
          {terminalSettings?.updatedAt && (
            <span className="config-updated-note">Updated {formatDate(terminalSettings.updatedAt)}</span>
          )}
        </div>
      </section>

      <section className="config-card git-backend-card">
        <h3>Git backend</h3>
        <label id="git-backend-label">Read backend</label>
        <div className="git-backend-options" role="radiogroup" aria-labelledby="git-backend-label">
          {gitBackendPreferences.map((preference) => {
            const active = preference === gitBackendPreference
            return (
              <button
                type="button"
                key={preference}
                role="radio"
                aria-checked={active}
                className={active ? 'git-backend-option active' : 'git-backend-option'}
                onClick={() => { if (!active) void saveGitBackendSettings(preference) }}
                disabled={editorSettingsLoading || busy}
              >
                <strong>{gitBackendPreferenceLabel(preference)}</strong>
                <span>{gitBackendPreferenceDescription(preference)}</span>
              </button>
            )
          })}
        </div>
        <p className="muted-text">
          Console git is recommended for full accuracy. The built-in backend is a limited fallback that works without a system git install; renames, conflicts, submodules, and errors fall back to console automatically.
        </p>
        {gitBackendSettings?.updatedAt && (
          <span className="config-updated-note">Updated {formatDate(gitBackendSettings.updatedAt)}</span>
        )}
      </section>

      <section className="config-card git-monitor-card">
        <h3>Background refresh</h3>
        <p className="muted-text">
          While enabled, BranchPilot polls in the background to notify you about the active pull request and to warm caches so click-time actions feel instant.
        </p>
        <label className="git-monitor-toggle" htmlFor="git-monitor-enabled">
          <input
            id="git-monitor-enabled"
            type="checkbox"
            checked={monitorEnabled}
            onChange={(event) => void saveGitMonitorSettings({ enabled: event.target.checked })}
            disabled={monitorDisabled}
          />
          <span>Watch the active pull request and raise desktop notifications</span>
        </label>
        <p className="muted-text">
          BranchPilot polls the current branch's pull request in the background and notifies you when it merges, closes, checks pass or fail, or a review lands.
        </p>
        <label htmlFor="git-monitor-interval">Check every (seconds)</label>
        <input
          id="git-monitor-interval"
          type="number"
          min={20}
          max={600}
          step={5}
          value={gitMonitorSettings?.intervalSeconds ?? 60}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            if (Number.isFinite(parsed)) void saveGitMonitorSettings({ intervalSeconds: parsed })
          }}
          disabled={monitorDisabled || !monitorEnabled}
        />
        <div className="git-monitor-events">
          <label htmlFor="git-monitor-merged">
            <input
              id="git-monitor-merged"
              type="checkbox"
              checked={gitMonitorSettings?.notifyMerged ?? true}
              onChange={(event) => void saveGitMonitorSettings({ notifyMerged: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>PR merged or closed</span>
          </label>
          <label htmlFor="git-monitor-checks">
            <input
              id="git-monitor-checks"
              type="checkbox"
              checked={gitMonitorSettings?.notifyChecks ?? true}
              onChange={(event) => void saveGitMonitorSettings({ notifyChecks: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Checks passed or failed</span>
          </label>
          <label htmlFor="git-monitor-reviews">
            <input
              id="git-monitor-reviews"
              type="checkbox"
              checked={gitMonitorSettings?.notifyReviews ?? true}
              onChange={(event) => void saveGitMonitorSettings({ notifyReviews: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Review approved or changes requested</span>
          </label>
        </div>
        <label className="git-monitor-subheading">Cache warming tasks</label>
        <div className="git-monitor-events">
          <label htmlFor="git-monitor-periodic-fetch">
            <input
              id="git-monitor-periodic-fetch"
              type="checkbox"
              checked={gitMonitorSettings?.periodicFetch ?? true}
              onChange={(event) => void saveGitMonitorSettings({ periodicFetch: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Periodic fetch</span>
          </label>
          <label htmlFor="git-monitor-refresh-repo-list">
            <input
              id="git-monitor-refresh-repo-list"
              type="checkbox"
              checked={gitMonitorSettings?.refreshRepoList ?? true}
              onChange={(event) => void saveGitMonitorSettings({ refreshRepoList: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Keep repo list fresh</span>
          </label>
          <label htmlFor="git-monitor-prefetch-reports-graph">
            <input
              id="git-monitor-prefetch-reports-graph"
              type="checkbox"
              checked={gitMonitorSettings?.prefetchReportsGraph ?? true}
              onChange={(event) => void saveGitMonitorSettings({ prefetchReportsGraph: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Prefetch Reports graph</span>
          </label>
          <label htmlFor="git-monitor-refresh-account">
            <input
              id="git-monitor-refresh-account"
              type="checkbox"
              checked={gitMonitorSettings?.refreshAccount ?? true}
              onChange={(event) => void saveGitMonitorSettings({ refreshAccount: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Refresh account</span>
          </label>
          <label htmlFor="git-monitor-sync-memory">
            <input
              id="git-monitor-sync-memory"
              type="checkbox"
              checked={gitMonitorSettings?.syncMemory ?? false}
              onChange={(event) => void saveGitMonitorSettings({ syncMemory: event.target.checked })}
              disabled={monitorDisabled || !monitorEnabled}
            />
            <span>Sync memory <span className="muted-text">(heavier, optional)</span></span>
          </label>
        </div>
        {gitMonitorSettings?.updatedAt && (
          <span className="config-updated-note">Updated {formatDate(gitMonitorSettings.updatedAt)}</span>
        )}
      </section>
    </>
  )
}
