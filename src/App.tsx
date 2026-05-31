import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  FolderOpen,
  GitCommitHorizontal,
  Plus,
  RefreshCcw,
  Settings,
  UploadCloud
} from 'lucide-react'
import {
  changeList,
  diffPreview,
  localCapabilities,
  navigationItems,
  providerSummaries,
  repositoryStats,
  reviewModes
} from './data/workspace'
import './App.css'

function App() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [repositoryPath, setRepositoryPath] = useState('~/dev/branchpilot-demo')

  useEffect(() => {
    void window.branchPilot?.getVersion().then(setAppVersion)
  }, [])

  const chooseRepository = async () => {
    const selectedPath = await window.branchPilot?.chooseRepositoryFolder()

    if (selectedPath) {
      setRepositoryPath(selectedPath)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BP</div>
          <div>
            <strong>BranchPilot</strong>
            <span>Desktop Git client</span>
          </div>
        </div>

        <button className="repo-picker" type="button" onClick={chooseRepository}>
          <FolderOpen size={18} />
          <span>{repositoryPath}</span>
          <ChevronDown size={16} />
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navigationItems.map((item, index) => (
            <button className={index === 0 ? 'active' : ''} type="button" key={item.label}>
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="provider-list">
          <span className="section-label">Providers</span>
          {providerSummaries.map((provider) => (
            <div className="provider-row" key={provider.name}>
              <provider.icon size={18} />
              <span>{provider.name}</span>
              <em>{provider.state}</em>
            </div>
          ))}
        </div>

        <button className="settings-button" type="button">
          <Settings size={18} />
          Settings
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Repository workspace</p>
            <h1>feature/review-panel</h1>
          </div>
          <div className="toolbar" aria-label="Repository actions">
            <button type="button" title="Fetch">
              <RefreshCcw size={17} />
              Fetch
            </button>
            <button type="button" title="Pull">
              <ArrowDownToLine size={17} />
              Pull
            </button>
            <button type="button" title="Push">
              <ArrowUpFromLine size={17} />
              Push
            </button>
          </div>
        </header>

        <section className="stats-grid" aria-label="Repository status">
          {repositoryStats.map((stat) => (
            <div className="stat-tile" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </section>

        <section className="content-grid">
          <div className="changes-panel">
            <div className="panel-heading">
              <div>
                <h2>Changes</h2>
                <p>Stage files, inspect diffs, and prepare the next commit.</p>
              </div>
              <button type="button" className="icon-button" title="Stage all">
                <Plus size={18} />
              </button>
            </div>

            <div className="change-list">
              {changeList.map((change) => (
                <button className="change-row" type="button" key={change.path}>
                  <span className="file-status">{change.status[0]}</span>
                  <span className="file-name">{change.path}</span>
                  <span className="file-delta">
                    +{change.additions} -{change.deletions}
                  </span>
                </button>
              ))}
            </div>

            <div className="commit-box">
              <label htmlFor="commit-title">Commit title</label>
              <input id="commit-title" defaultValue="Add repository review surface" />
              <label htmlFor="commit-description">Description</label>
              <textarea
                id="commit-description"
                defaultValue="Adds the first review dashboard layout and local repository status panels."
              />
              <div className="commit-actions">
                <button type="button">
                  <GitCommitHorizontal size={17} />
                  Commit
                </button>
                <button type="button" className="secondary">
                  <UploadCloud size={17} />
                  Commit & push
                </button>
              </div>
            </div>
          </div>

          <div className="diff-panel">
            <div className="panel-heading">
              <div>
                <h2>Diff preview</h2>
                <p>src/review/repositoryCheck.ts</p>
              </div>
              <span className="status-pill">4 files selected</span>
            </div>
            <pre className="diff-preview">
              {diffPreview.map((line) => (
                <code
                  className={`line marker-${line.marker === '+' ? 'add' : line.marker === '-' ? 'remove' : 'base'}`}
                  key={line.text}
                >
                  <span>{line.marker}</span>
                  {line.text}
                </code>
              ))}
            </pre>

            <div className="review-grid">
              {reviewModes.map((mode) => (
                <article className="review-card" key={mode.title}>
                  <mode.icon size={20} />
                  <h3>{mode.title}</h3>
                  <p>{mode.description}</p>
                  <span>{mode.state}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <footer className="status-bar">
          <div className="capability-list">
            {localCapabilities.map((capability) => (
              <span key={capability.label}>
                <capability.icon size={15} />
                {capability.label}
              </span>
            ))}
          </div>
          <span>
            <Check size={15} />
            v{appVersion}
          </span>
        </footer>
      </section>
    </main>
  )
}

export default App
