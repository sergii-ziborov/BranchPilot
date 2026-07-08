import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { EDITOR_LIVE_CHANGES_DEBOUNCE_MS } from './editorViewConstants'
import type { EditorViewMode } from './editorViewHelpers'

interface UseEditorLiveChangesSyncParams {
  viewMode: EditorViewMode
  textDirty: boolean
  activeEditorText: string
  activeEditorLineBase: number
  selectedPath: string
  setLiveChangesOpen: Dispatch<SetStateAction<boolean>>
  setLiveChangesText: Dispatch<SetStateAction<string | null>>
}

export function useEditorLiveChangesSync({
  viewMode,
  textDirty,
  activeEditorText,
  activeEditorLineBase,
  selectedPath,
  setLiveChangesOpen,
  setLiveChangesText
}: UseEditorLiveChangesSyncParams): void {
  useEffect(() => {
    setLiveChangesOpen(true)
  }, [viewMode])

  useEffect(() => {
    if (!textDirty) setLiveChangesOpen(true)
  }, [textDirty])

  useEffect(() => {
    if (!textDirty) {
      setLiveChangesText(activeEditorText)
    }
  }, [activeEditorText, textDirty])

  useEffect(() => {
    if (!textDirty) return

    const handle = window.setTimeout(() => {
      setLiveChangesText(activeEditorText)
    }, EDITOR_LIVE_CHANGES_DEBOUNCE_MS)

    return () => window.clearTimeout(handle)
  }, [activeEditorLineBase, activeEditorText, selectedPath, textDirty])
}
