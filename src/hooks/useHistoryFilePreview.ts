import { useEffect, useRef, useState } from 'react'
import type { BranchPilotApi, CommitDetails } from '../shared/branchPilot'
import type { HistoryFilePreviewModel } from '../components/history/HistoryFilePreview'
import { friendlyIpcErrorMessage } from '../lib/ipcErrorMessage'

interface UseHistoryFilePreviewOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  commitDetails: CommitDetails | null
}

export function useHistoryFilePreview({
  api,
  currentRepoPath,
  commitDetails
}: UseHistoryFilePreviewOptions) {
  const [filePreview, setFilePreview] = useState<HistoryFilePreviewModel | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    requestIdRef.current += 1
    setFilePreview(null)
  }, [commitDetails?.sha, currentRepoPath])

  const openCommitFilePreview = (filePath: string) => {
    if (!api || !currentRepoPath || !commitDetails) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const basePreview: HistoryFilePreviewModel = {
      commitSha: commitDetails.sha,
      shortSha: commitDetails.shortSha,
      filePath,
      loading: true,
      error: null,
      content: null
    }

    setFilePreview(basePreview)
    void api
      .getCommitFileContent({ repoPath: currentRepoPath, commitSha: commitDetails.sha, filePath })
      .then((result) => {
        if (requestIdRef.current !== requestId) return
        if (result.ok) {
          setFilePreview({ ...basePreview, loading: false, content: result.data })
          return
        }
        setFilePreview({
          ...basePreview,
          loading: false,
          error: friendlyIpcErrorMessage(
            result.error.message || result.error.details || '',
            'Failed to load this file from the selected commit.'
          )
        })
      })
      .catch((error) => {
        if (requestIdRef.current !== requestId) return
        const message = error instanceof Error ? error.message : ''
        setFilePreview({
          ...basePreview,
          loading: false,
          error: friendlyIpcErrorMessage(message, 'Failed to load this file from the selected commit.')
        })
      })
  }

  return {
    filePreview,
    setFilePreview,
    openCommitFilePreview
  }
}
