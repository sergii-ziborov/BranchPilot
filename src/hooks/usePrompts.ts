import { useEffect, useRef, useState } from 'react'
import type {
  ConfirmationOptions, ConfirmationRequest, TextPromptOptions, TextPromptRequest
} from '../lib/prompts'

/** Modal confirmation + text-prompt subsystem: promise-based requests with Escape-to-cancel. */
export function usePrompts() {
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [textPromptRequest, setTextPromptRequest] = useState<TextPromptRequest | null>(null)
  const [textPromptValue, setTextPromptValue] = useState('')
  const confirmationIdRef = useRef(0)

  function requestConfirmation(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
    if (confirmationRequest) return Promise.resolve(false)

    return new Promise((resolve) => {
      confirmationIdRef.current += 1
      setConfirmationRequest({
        id: confirmationIdRef.current,
        title: options.title ?? 'Confirm action',
        message,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        variant: options.variant ?? 'default',
        resolve
      })
    })
  }

  function answerConfirmation(confirmed: boolean) {
    if (!confirmationRequest) return
    const request = confirmationRequest
    setConfirmationRequest(null)
    request.resolve(confirmed)
  }

  function requestTextInput(message: string, options: TextPromptOptions = {}): Promise<string | null> {
    if (textPromptRequest || confirmationRequest) return Promise.resolve(null)

    return new Promise((resolve) => {
      confirmationIdRef.current += 1
      setTextPromptValue(options.defaultValue ?? '')
      setTextPromptRequest({
        id: confirmationIdRef.current,
        title: options.title ?? 'Enter value',
        message,
        confirmLabel: options.confirmLabel ?? 'Save',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        defaultValue: options.defaultValue ?? '',
        placeholder: options.placeholder ?? '',
        resolve
      })
    })
  }

  function answerTextPrompt(submitted: boolean) {
    if (!textPromptRequest) return
    const request = textPromptRequest
    setTextPromptRequest(null)
    request.resolve(submitted ? textPromptValue : null)
  }

  useEffect(() => {
    if (!confirmationRequest) return

    const request = confirmationRequest
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setConfirmationRequest(null)
      request.resolve(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmationRequest])

  useEffect(() => {
    if (!textPromptRequest) return

    const request = textPromptRequest
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTextPromptRequest(null)
      request.resolve(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [textPromptRequest])

  return {
    confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue,
    requestConfirmation, answerConfirmation, requestTextInput, answerTextPrompt
  }
}
