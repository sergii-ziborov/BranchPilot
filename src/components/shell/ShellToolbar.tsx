import type { ComponentType } from 'react'
import { CalendarDays, Check, ChevronDown, GitPullRequest, Palette, RefreshCcw, Settings } from 'lucide-react'
import type { ViewMode } from '../../lib/viewMode'
import { IconButton } from '../IconButton'
import { useController } from '../../hooks/AppControllerContext'
import { APP_THEMES, useAppTheme } from '../../hooks/useAppTheme'

type TabIcon = ComponentType<{ size?: number }>

const TOOL_TABS: { id: ViewMode; label: string; icon: TabIcon }[] = [
  { id: 'providers', label: 'Pull requests', icon: GitPullRequest },
  { id: 'daily', label: 'Reports', icon: CalendarDays }
]

/** Right-hand toolbar: view-mode tool tabs, refresh + git-settings buttons, and
 *  the theme picker menu. */
export function ShellToolbar({
  handleToggle,
  closeMenu
}: {
  handleToggle: (event: { currentTarget: HTMLDetailsElement }) => void
  closeMenu: (event: { currentTarget: HTMLElement }) => void
}) {
  const { snapshot, busy, viewMode, setViewMode, allReposMode, refreshRepository } = useController()
  const [theme, setTheme] = useAppTheme()

  return (
    <div className="shell-tabs-tools">
      {TOOL_TABS.filter((tab) => !allReposMode || tab.id === 'daily').map((tab) => {
        const isActive = viewMode === tab.id || (tab.id === 'daily' && (viewMode === 'linkedin' || viewMode === 'memory' || viewMode === 'wiki'))
        return (
        <button
          className={isActive ? 'shell-tool active' : 'shell-tool'}
          type="button"
          key={tab.id}
          title={isActive ? `Back to Changes (close ${tab.label})` : tab.label}
          aria-pressed={isActive}
          onClick={() => setViewMode(isActive ? 'changes' : tab.id)}
        >
          <tab.icon size={15} />
          <span>{tab.label}</span>
        </button>
        )
      })}

      {!allReposMode && (
        <>
          <IconButton icon={<RefreshCcw size={17} />} label="Refresh repository" disabled={!snapshot || busy} onClick={() => refreshRepository()} />
          <IconButton
            icon={<Settings size={17} />}
            label="Git settings"
            title={viewMode === 'config' ? 'Back to Changes' : 'Git settings'}
            active={viewMode === 'config'}
            disabled={!snapshot || busy}
            onClick={() => setViewMode(viewMode === 'config' ? 'changes' : 'config')}
          />
        </>
      )}

      <details className="shell-menu shell-theme" onToggle={handleToggle}>
        <summary>
          <span className="shell-seg-value">
            <Palette size={15} />
            <ChevronDown size={14} />
          </span>
        </summary>
        <div className="shell-dropdown shell-theme-dropdown">
          {APP_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={theme === t.id ? 'shell-theme-item active' : 'shell-theme-item'}
              onClick={(event) => { closeMenu(event); setTheme(t.id) }}
            >
              <span className="shell-theme-dot" style={{ background: t.dot }} />
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
              {theme === t.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
