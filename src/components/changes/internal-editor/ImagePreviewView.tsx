import { FileImage } from 'lucide-react'
import type { ImagePreview } from '../../../shared/branchPilot'
import { SignalStatus } from '../../SignalStatus'
import { formatBytes } from './editorPrimitives'

export interface ImagePreviewViewProps {
  selectedPath: string
  selectedIsSvg: boolean
  draftText: string
  activeImagePreviewUrl: string
  imagePreview: ImagePreview | null
  imagePreviewError: string | null
  imagePreviewLoading: boolean
}

export function ImagePreviewView({
  selectedPath,
  selectedIsSvg,
  draftText,
  activeImagePreviewUrl,
  imagePreview,
  imagePreviewError,
  imagePreviewLoading
}: ImagePreviewViewProps) {
  return (
    <div className="changes-editor-media-shell">
      {activeImagePreviewUrl ? (
        <div className="changes-editor-image-stage">
          <img src={activeImagePreviewUrl} alt={selectedPath} />
          <span>
            {selectedIsSvg && draftText ? 'Live SVG preview' : imagePreview ? `${formatBytes(imagePreview.byteSize)} - ${imagePreview.mimeType}` : 'Image preview'}
          </span>
        </div>
      ) : imagePreviewError ? (
        <div className="changes-editor-mode-message danger-text">
          <FileImage size={28} />
          <strong>Preview unavailable</strong>
          <span>{imagePreviewError}</span>
        </div>
      ) : (
        <SignalStatus
          className="changes-editor-file-curtain changes-editor-file-curtain-static"
          label={imagePreviewLoading ? 'Loading image preview' : 'Preparing preview'}
          detail={selectedPath}
        />
      )}
      {imagePreviewLoading && activeImagePreviewUrl && (
        <SignalStatus
          compact
          className="changes-editor-file-curtain changes-editor-media-loading"
          label="Refreshing preview"
          detail={selectedPath}
        />
      )}
    </div>
  )
}
