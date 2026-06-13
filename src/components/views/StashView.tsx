import { ArrowDownToLine, RefreshCcw, Save, Trash2 } from 'lucide-react'
import type { StashEntry } from '../../shared/branchPilot'

export function StashView({
  loadStashes,
  busy,
  stashMessage,
  setStashMessage,
  defaultStashMessage,
  createStash,
  canCreateStash,
  stashes,
  applyStash,
  dropStash
}: {
  loadStashes: () => void | Promise<void>
  busy: boolean
  stashMessage: string
  setStashMessage: (value: string) => void
  defaultStashMessage: () => string
  createStash: () => void | Promise<void>
  canCreateStash: boolean
  stashes: StashEntry[]
  applyStash: (stash: StashEntry) => void | Promise<void>
  dropStash: (stash: StashEntry) => void | Promise<void>
}) {
  return (
    <section className="single-panel">
      <div className="panel-heading">
        <div>
          <h2>Stash</h2>
          <p>Store unfinished tracked and untracked work without committing.</p>
        </div>
        <button type="button" onClick={() => loadStashes()} disabled={busy}>
          <RefreshCcw size={17} />
          Refresh
        </button>
      </div>

      <div className="stash-workspace">
        <section className="stash-create">
          <div>
            <h3>Create stash</h3>
            <p>Includes tracked and untracked changes. Ignored files stay untouched.</p>
          </div>
          <input
            id="stash-message"
            value={stashMessage}
            onChange={(event) => setStashMessage(event.target.value)}
            placeholder={defaultStashMessage()}
          />
          <button type="button" onClick={() => createStash()} disabled={busy || !canCreateStash}>
            <Save size={17} />
            Stash changes
          </button>
        </section>

        <section className="stash-list">
          {stashes.length === 0 ? (
            <div className="quiet-box">No stashes for this repository.</div>
          ) : (
            stashes.map((stash) => (
              <article className="stash-row" key={stash.ref}>
                <div>
                  <span>{stash.ref} · {stash.createdAtLabel}</span>
                  <strong>{stash.message}</strong>
                  <code>{stash.sha.slice(0, 12)}</code>
                </div>
                <div className="stash-actions">
                  <button type="button" onClick={() => applyStash(stash)} disabled={busy}>
                    <ArrowDownToLine size={17} />
                    Apply
                  </button>
                  <button className="danger-button" type="button" onClick={() => dropStash(stash)} disabled={busy}>
                    <Trash2 size={17} />
                    Drop
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </section>
  )
}
