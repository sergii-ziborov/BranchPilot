import { Bot, Loader2, Wand2 } from 'lucide-react'

export function PublishStarterCard({
  generating,
  submitting,
  canGenerateStarter,
  starterBlockedText,
  generateStarterTitle,
  generateDisabled,
  onDraftLocally,
  onGenerate,
  includeReadme,
  setIncludeReadme,
  readme,
  setReadme,
  includeGitignore,
  setIncludeGitignore,
  gitignore,
  setGitignore,
  commitStarterFiles,
  setCommitStarterFiles,
  pushAfterCreate,
  setPushAfterCreate
}: {
  generating: boolean
  submitting: boolean
  canGenerateStarter: boolean
  starterBlockedText: string
  generateStarterTitle: string
  generateDisabled: boolean
  onDraftLocally: () => void
  onGenerate: () => void
  includeReadme: boolean
  setIncludeReadme: (include: boolean) => void
  readme: string
  setReadme: (readme: string) => void
  includeGitignore: boolean
  setIncludeGitignore: (include: boolean) => void
  gitignore: string
  setGitignore: (gitignore: string) => void
  commitStarterFiles: boolean
  setCommitStarterFiles: (commit: boolean) => void
  pushAfterCreate: boolean
  setPushAfterCreate: (push: boolean) => void
}) {
  return (
    <div className="publish-card publish-starter-card">
      <div className="publish-card-heading">
        <div>
          <h3>Starter files</h3>
          <p>Draft README.md, .gitignore, and description before BranchPilot writes anything.</p>
        </div>
        <div className="publish-starter-actions">
          <button type="button" className="secondary" onClick={onDraftLocally} disabled={submitting}>
            <Wand2 size={16} />
            Draft locally
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generateDisabled}
            title={generateStarterTitle}
          >
            {generating ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
            Generate with AI
          </button>
        </div>
      </div>

      {!canGenerateStarter && (
        <div className="assistant-policy-note">{starterBlockedText}</div>
      )}

      <label className="publish-check">
        <input type="checkbox" checked={includeReadme} onChange={(event) => setIncludeReadme(event.target.checked)} />
        <span>Write README.md if missing</span>
      </label>
      <textarea className="publish-readme" value={readme} onChange={(event) => setReadme(event.target.value)} placeholder="# README.md" />

      <label className="publish-check">
        <input type="checkbox" checked={includeGitignore} onChange={(event) => setIncludeGitignore(event.target.checked)} />
        <span>Write .gitignore if missing</span>
      </label>
      <textarea className="publish-gitignore" value={gitignore} onChange={(event) => setGitignore(event.target.value)} placeholder={'node_modules/\ndist/'} />

      <div className="publish-options">
        <label className="publish-check">
          <input type="checkbox" checked={commitStarterFiles} onChange={(event) => setCommitStarterFiles(event.target.checked)} />
          <span>Commit generated starter files</span>
        </label>
        <label className="publish-check">
          <input type="checkbox" checked={pushAfterCreate} onChange={(event) => setPushAfterCreate(event.target.checked)} />
          <span>Push current branch after creating remote</span>
        </label>
      </div>
    </div>
  )
}
