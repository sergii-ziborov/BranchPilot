import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  jsonEditInitialValue,
  jsonEditableKind,
  parseJsonEditValue,
  updateJsonValueAtPath,
  type JsonEditCell,
  type JsonTreeNode
} from './jsonTreeUtils'
import { beautifyJsoncText } from './editorBeautify'
import { isJsoncFilePath, parseEditorJsonText } from './editorLintHelpers'
import {
  parseSvgDocument,
  serializeSvgDocument,
  svgElements,
  type SvgColorTarget
} from './svgUtils'
import type { EditorLintSettings } from './lintSettings'

interface UseEditorStructuredEditingParams {
  selectedPath: string
  draftText: string
  lintSettings: EditorLintSettings
  jsonEdit: JsonEditCell | null
  jsonExpandablePaths: string[]
  skipJsonEditBlurRef: MutableRefObject<boolean>
  setCollapsedJsonPaths: Dispatch<SetStateAction<Set<string>>>
  setJsonEdit: Dispatch<SetStateAction<JsonEditCell | null>>
  applyEditorTextChange: (
    nextText: string,
    options?: {
      selectionStart?: number
      selectionEnd?: number
      resetJsonCollapse?: boolean
    }
  ) => boolean
  setNotice: (message: string) => void
}

export function useEditorStructuredEditing({
  selectedPath,
  draftText,
  lintSettings,
  jsonEdit,
  jsonExpandablePaths,
  skipJsonEditBlurRef,
  setCollapsedJsonPaths,
  setJsonEdit,
  applyEditorTextChange,
  setNotice
}: UseEditorStructuredEditingParams) {
  const updateSvgRootAttribute = (attr: string, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) parsed.document.documentElement.setAttribute(attr, nextValue)
    else parsed.document.documentElement.removeAttribute(attr)
    applyEditorTextChange(serializeSvgDocument(parsed.document))
  }

  const updateSvgColorAttribute = (target: SvgColorTarget, value: string) => {
    const parsed = parseSvgDocument(draftText)
    if (!parsed.document) {
      setNotice(parsed.error || 'SVG edit failed.')
      return
    }

    const element = svgElements(parsed.document)[target.index]
    if (!element) {
      setNotice('SVG element no longer exists.')
      return
    }

    const nextValue = value.trim()
    if (nextValue) element.setAttribute(target.attr, nextValue)
    else element.removeAttribute(target.attr)
    applyEditorTextChange(serializeSvgDocument(parsed.document))
  }

  const toggleJsonNode = (path: string) => {
    setCollapsedJsonPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAllJson = () => setCollapsedJsonPaths(new Set())

  const collapseAllJson = () => {
    setCollapsedJsonPaths(new Set(jsonExpandablePaths))
  }

  const formatJsonDraft = () => {
    try {
      const formatted = isJsoncFilePath(selectedPath)
        ? beautifyJsoncText(draftText)
        : `${JSON.stringify(parseEditorJsonText(selectedPath, draftText, lintSettings).value, null, 2)}\n`
      applyEditorTextChange(formatted, { resetJsonCollapse: true })
      setCollapsedJsonPaths(new Set())
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON format failed: ${error.message}` : 'JSON format failed.')
    }
  }

  const beginJsonEdit = (row: JsonTreeNode) => {
    const kind = jsonEditableKind(row.value)
    if (!kind) return
    setJsonEdit({
      path: row.path,
      kind,
      value: jsonEditInitialValue(row.value)
    })
  }

  const cancelJsonEdit = () => {
    skipJsonEditBlurRef.current = true
    setJsonEdit(null)
  }

  const commitJsonEdit = (edit = jsonEdit) => {
    if (!edit) return

    try {
      const rootValue = parseEditorJsonText(selectedPath, draftText, lintSettings).value
      const nextValue = parseJsonEditValue(edit.kind, edit.value)
      const nextRootValue = updateJsonValueAtPath(rootValue, edit.path, nextValue)
      applyEditorTextChange(`${JSON.stringify(nextRootValue, null, 2)}\n`)
      setJsonEdit(null)
    } catch (error) {
      setNotice(error instanceof Error ? `JSON edit failed: ${error.message}` : 'JSON edit failed.')
    }
  }

  return {
    updateSvgRootAttribute,
    updateSvgColorAttribute,
    toggleJsonNode,
    expandAllJson,
    collapseAllJson,
    formatJsonDraft,
    beginJsonEdit,
    cancelJsonEdit,
    commitJsonEdit
  }
}
