import { useEffect, useRef, useState } from 'react'
import type {
  BranchPilotApi,
  CommitDetails,
  CommitFileContentResult,
  DiffResult
} from '../../shared/branchPilot'

interface CommitCompareDataOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  commitSha: string
  filePath: string
  compareSha: string
}

export function useCommitCompareData({ api, currentRepoPath, commitSha, filePath, compareSha }: CommitCompareDataOptions) {
  const compareDetailsRequestRef = useRef(0)
  const compareFileRequestRef = useRef(0)
  const compareDiffRequestRef = useRef(0)
  const [compareDetails, setCompareDetails] = useState<CommitDetails | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareFileContent, setCompareFileContent] = useState<CommitFileContentResult | null>(null)
  const [compareFileLoading, setCompareFileLoading] = useState(false)
  const [compareFileError, setCompareFileError] = useState<string | null>(null)
  const [compareDiff, setCompareDiff] = useState<DiffResult | null>(null)
  const [compareDiffLoading, setCompareDiffLoading] = useState(false)
  const [compareDiffError, setCompareDiffError] = useState<string | null>(null)

  useEffect(() => {
    const requestId = compareDetailsRequestRef.current + 1
    compareDetailsRequestRef.current = requestId
    setCompareDetails(null)
    setCompareError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareLoading(false)
      return
    }

    setCompareLoading(true)
    void api
      .getCommitDetails({ repoPath: currentRepoPath, commitSha: compareSha })
      .then((result) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        if (result.ok) {
          setCompareDetails(result.data)
          return
        }
        setCompareError(result.error.message || result.error.details || 'Failed to load compare commit.')
      })
      .catch((error) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        setCompareError(error instanceof Error ? error.message : 'Failed to load compare commit.')
      })
  }, [api, compareSha, currentRepoPath])

  useEffect(() => {
    const requestId = compareFileRequestRef.current + 1
    compareFileRequestRef.current = requestId
    setCompareFileContent(null)
    setCompareFileError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareFileLoading(false)
      return
    }

    setCompareFileLoading(true)
    void api
      .getCommitFileContent({ repoPath: currentRepoPath, commitSha: compareSha, filePath })
      .then((result) => {
        if (compareFileRequestRef.current !== requestId) return
        setCompareFileLoading(false)
        if (result.ok) {
          setCompareFileContent(result.data)
          return
        }
        setCompareFileError(result.error.message || result.error.details || 'This file does not exist at the compare target.')
      })
      .catch((error) => {
        if (compareFileRequestRef.current !== requestId) return
        setCompareFileLoading(false)
        setCompareFileError(error instanceof Error ? error.message : 'This file does not exist at the compare target.')
      })
  }, [api, compareSha, currentRepoPath, filePath])

  useEffect(() => {
    const requestId = compareDiffRequestRef.current + 1
    compareDiffRequestRef.current = requestId
    setCompareDiff(null)
    setCompareDiffError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareDiffLoading(false)
      return
    }

    setCompareDiffLoading(true)
    void api
      .getCommitFileCompareDiff({
        repoPath: currentRepoPath,
        commitSha,
        compareCommitSha: compareSha,
        filePath
      })
      .then((result) => {
        if (compareDiffRequestRef.current !== requestId) return
        setCompareDiffLoading(false)
        if (result.ok) {
          setCompareDiff(result.data)
          return
        }
        setCompareDiffError(result.error.message || result.error.details || 'Failed to load compare diff.')
      })
      .catch((error) => {
        if (compareDiffRequestRef.current !== requestId) return
        setCompareDiffLoading(false)
        setCompareDiffError(error instanceof Error ? error.message : 'Failed to load compare diff.')
      })
  }, [api, compareSha, commitSha, currentRepoPath, filePath])

  return {
    compareDetails,
    compareLoading,
    compareError,
    compareFileContent,
    compareFileLoading,
    compareFileError,
    compareDiff,
    compareDiffLoading,
    compareDiffError
  }
}
