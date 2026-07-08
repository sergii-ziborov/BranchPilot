import { useState } from 'react'
import type { ApiResult, GitOperationResult } from '../../shared/branchPilot'
import { branchPilotErrorText } from '../../shared/branchPilot'
import { progressLabelFromSuccess } from '../../lib/progressLabels'

/** Owns the busy/progress state and the shared runners that wrap API calls. */
export function useOperationRunner({
  setNotice,
  setError
}: {
  setNotice: (message: string) => void
  setError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)

  async function runBusyOperation<T>(label: string, action: () => Promise<T>): Promise<T> {
    setBusy(true)
    setOperationLabel(label)
    setError(null)

    try {
      return await action()
    } finally {
      setBusy(false)
      setOperationLabel(null)
    }
  }

  async function runApiAction<T>(
    progressLabel: string,
    action: () => Promise<ApiResult<T>>,
    onSuccess: (data: T) => void | Promise<void>
  ): Promise<boolean> {
    return runBusyOperation(progressLabel, async () => {
      const result = await action()

      if (result.ok) {
        await onSuccess(result.data)
        return true
      }

      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return false
    })
  }

  async function runOperationAction(
    label: string,
    action: () => Promise<ApiResult<GitOperationResult>>,
    progressLabel = progressLabelFromSuccess(label)
  ) {
    await runBusyOperation(progressLabel, async () => {
      const result = await action()

      if (result.ok) {
        setNotice(result.data.message || label)
        setError(null)
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  return { busy, setBusy, operationLabel, setOperationLabel, runBusyOperation, runApiAction, runOperationAction }
}
