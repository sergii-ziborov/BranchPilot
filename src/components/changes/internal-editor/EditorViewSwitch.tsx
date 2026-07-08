import { CodeEditorView, type CodeEditorViewProps } from './CodeEditorView'
import { ImagePreviewView, type ImagePreviewViewProps } from './ImagePreviewView'
import { HexEditorView, type HexEditorViewProps } from './HexEditorView'
import { SvgEditorView, type SvgEditorViewProps } from './SvgEditorView'
import { JsonViewerView, type JsonViewerViewProps } from './JsonViewerView'
import type { EditorViewMode } from './editorViewHelpers'

type EditorViewSwitchProps = CodeEditorViewProps
  & ImagePreviewViewProps
  & HexEditorViewProps
  & SvgEditorViewProps
  & JsonViewerViewProps
  & { viewMode: EditorViewMode }

export function EditorViewSwitch(props: EditorViewSwitchProps) {
  if (props.viewMode === 'image') return <ImagePreviewView {...props} />
  if (props.viewMode === 'svg-editor') return <SvgEditorView {...props} />
  if (props.viewMode === 'json') return <JsonViewerView {...props} />
  if (props.viewMode === 'hex') return <HexEditorView {...props} />
  return <CodeEditorView {...props} />
}
