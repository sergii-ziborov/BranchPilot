import { useState } from 'react'
import { isSafeExternalUrl } from '../../shared/externalUrl'

/** Owns the user-facing notice/error state plus clipboard and external-link helpers. */
export function useAppFeedback() {
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)

  async function copyToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError('Clipboard is not available in this runtime.')
    }
  }

  function openExternalLink(url: string | undefined, label = 'External link') {
    if (!url || !isSafeExternalUrl(url)) {
      setError(`${label} was blocked because it is not a safe HTTPS URL.`)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return { notice, setNotice, error, setError, copyToClipboard, openExternalLink }
}
