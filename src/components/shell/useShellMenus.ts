import { useEffect, useRef, useState } from 'react'

export type BranchActionMode = 'rename' | 'describe' | 'delete'

export interface BranchActionState {
  name: string
  mode: BranchActionMode
}

/** Coordinates the shell bar's `<details>` menus (one open at a time, close on
 *  outside click / Escape) plus the inline branch-edit state that must reset
 *  whenever the branch menu closes. */
export function useShellMenus() {
  const headerRef = useRef<HTMLElement>(null)
  const [branchAction, setBranchAction] = useState<BranchActionState | null>(null)
  const [branchActionValue, setBranchActionValue] = useState('')
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)

  const startBranchAction = (name: string, mode: BranchActionMode, value: string) => {
    setBranchAction({ name, mode })
    setBranchActionValue(value)
    setBranchMenuOpen(true)
  }
  const cancelBranchAction = () => { setBranchAction(null); setBranchActionValue('') }

  useEffect(() => {
    const closeAll = () => {
      setBranchMenuOpen(false)
      setBranchAction(null)
      setBranchActionValue('')
      headerRef.current
        ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
        .forEach((d) => { d.open = false })
    }
    const onDocClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.shell-menu')) closeAll()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAll() }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // When one menu opens, close any other open menu.
  const handleToggle = (event: { currentTarget: HTMLDetailsElement }) => {
    const opened = event.currentTarget
    if (opened.classList.contains('shell-branch')) {
      setBranchMenuOpen(opened.open)
      if (!opened.open) {
        setBranchAction(null)
        setBranchActionValue('')
      }
    }
    if (!opened.open) return
    headerRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.shell-menu[open]')
      .forEach((d) => {
        if (d !== opened) {
          if (d.classList.contains('shell-branch')) {
            setBranchMenuOpen(false)
          }
          d.open = false
        }
      })
  }

  const closeMenu = (event: { currentTarget: HTMLElement }) => {
    const details = event.currentTarget.closest('details')
    if (details) {
      if (details.classList.contains('shell-branch')) {
        setBranchMenuOpen(false)
        setBranchAction(null)
        setBranchActionValue('')
      }
      details.open = false
    }
  }

  return {
    headerRef,
    branchAction,
    branchActionValue,
    setBranchActionValue,
    branchMenuOpen,
    startBranchAction,
    cancelBranchAction,
    handleToggle,
    closeMenu
  }
}
