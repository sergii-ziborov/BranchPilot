import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent
} from 'react'
import type {
  ApiResult,
  AssistantId,
  AssistantStatus,
  BranchPilotApi,
  CodexAgentAttachment,
  CodexAgentEvent,
  CodexAgentReasoning,
  CodexAgentResult,
  CodexAgentSandbox,
  RepositorySnapshot
} from '../../../shared/branchPilot'
import type { ConfirmationOptions } from '../../../lib/prompts'
import { assistantSelectionLabel, assistantStatusLabel } from '../../../lib/assistantLabels'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import type { EditorDiagnostic } from './editorTypes'
import { useAgentQueue } from './useAgentQueue'
import { useAgentSessionSummary } from './useAgentSessionSummary'
import {
  CODEX_AGENT_ATTACHMENT_LIMIT,
  LOCAL_AGENT_COMMANDS,
  appendLiveAgentEvents,
  compactAssistantUsage,
  filesFromTransferItems,
  friendlyAgentErrorMessage,
  isImageAttachmentFile,
  isTextAttachmentFile,
  localAgentDefaultAssistant,
  localAgentLabel,
  localAgentProviderForAssistant,
  readFileAsDataUrl,
  readFileAsTruncatedText,
  slashCommandQuery,
  type CodexAgentAttachmentDraft,
  type LocalAgentCommand,
  type LocalAgentProvider
} from './localAgentSupport'

/** Everything the local-agent panel needs, passed around as one unit. */
export type LocalAgentPanelState = ReturnType<typeof useLocalAgentPanel>

interface UseLocalAgentPanelOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  selectedAssistant: AssistantId
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  setNotice: (message: string) => void
  requestConfirmation: (message: string, options?: ConfirmationOptions) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  viewMode: string
  textUnavailableMessage: string | null
  fileError: string | null
  diagnostics: EditorDiagnostic[]
  flushActiveEditorDraftText: () => string
}

export function useLocalAgentPanel({
  api,
  currentRepoPath,
  selectedPath,
  selectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants,
  setNotice,
  requestConfirmation,
  runSnapshotAction,
  viewMode,
  textUnavailableMessage,
  fileError,
  diagnostics,
  flushActiveEditorDraftText
}: UseLocalAgentPanelOptions) {
  const codexAgentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const codexAgentAutoUsageCheckRef = useRef<Set<string>>(new Set())
  const codexAgentRunIdRef = useRef<string | null>(null)
  const [codexAgentOpen, setCodexAgentOpen] = useState(false)
  const [codexAgentPrompt, setCodexAgentPrompt] = useState('')
  const [codexAgentPromptFocused, setCodexAgentPromptFocused] = useState(false)
  const [codexAgentRunning, setCodexAgentRunning] = useState(false)
  const [codexAgentResult, setCodexAgentResult] = useState<CodexAgentResult | null>(null)
  const [codexAgentError, setCodexAgentError] = useState<string | null>(null)
  const [codexAgentLiveEvents, setCodexAgentLiveEvents] = useState<CodexAgentEvent[]>([])
  const [codexAgentStopping, setCodexAgentStopping] = useState(false)
  const [codexAgentStopped, setCodexAgentStopped] = useState(false)
  const [codexAgentAttachments, setCodexAgentAttachments] = useState<CodexAgentAttachmentDraft[]>([])
  const [codexAgentPreviewAttachment, setCodexAgentPreviewAttachment] = useState<CodexAgentAttachmentDraft | null>(null)
  const [codexAgentProvider, setCodexAgentProvider] = useState<LocalAgentProvider>(
    localAgentProviderForAssistant(selectedAssistant)
  )
  const [codexAgentAssistant, setCodexAgentAssistant] = useState<AssistantId>(
    selectedAssistant.startsWith('claude') || selectedAssistant.startsWith('codex') ? selectedAssistant : 'codex'
  )
  const [codexAgentReasoning, setCodexAgentReasoning] = useState<CodexAgentReasoning>('high')
  const [codexAgentSandbox, setCodexAgentSandbox] = useState<CodexAgentSandbox>('read-only')

  useEffect(() => {
    if (selectedAssistant.startsWith('claude') || selectedAssistant.startsWith('codex')) {
      setCodexAgentProvider(localAgentProviderForAssistant(selectedAssistant))
      setCodexAgentAssistant(selectedAssistant)
    }
  }, [selectedAssistant])

  useEffect(() => {
    if (!codexAgentOpen || assistantsChecking) return

    const checkKey = `${currentRepoPath ?? 'no-repo'}:${codexAgentProvider}`
    if (codexAgentAutoUsageCheckRef.current.has(checkKey)) return

    codexAgentAutoUsageCheckRef.current.add(checkKey)
    void checkAssistants()
  }, [assistantsChecking, checkAssistants, codexAgentOpen, codexAgentProvider, currentRepoPath])

  const codexAgentStatus = useMemo(
    () => assistants.find((assistant) => assistant.id === codexAgentProvider) ?? null,
    [assistants, codexAgentProvider]
  )
  const codexAgentStatusLabel = assistantsChecking
    ? 'checking'
    : codexAgentStatus
      ? assistantStatusLabel(codexAgentStatus)
      : 'unknown'
  const codexAgentStatusMessage = assistantsChecking
    ? 'Checking assistant access and usage.'
    : codexAgentStatus?.message ?? 'Run health check to load assistant access and usage.'
  const codexAgentUsageText = compactAssistantUsage(codexAgentStatus, assistantsChecking)
  const codexAgentCommandQuery = codexAgentPromptFocused ? slashCommandQuery(codexAgentPrompt) : null
  const codexAgentCommandSuggestions = useMemo(() => (
    codexAgentCommandQuery === null
      ? []
      : LOCAL_AGENT_COMMANDS.filter((command) =>
          command.id.includes(codexAgentCommandQuery) ||
          command.label.slice(1).includes(codexAgentCommandQuery)
        ).slice(0, 6)
  ), [codexAgentCommandQuery])

  const selectLocalAgentProvider = (provider: LocalAgentProvider, open = true) => {
    setCodexAgentProvider(provider)
    setCodexAgentAssistant((current) => (
      localAgentProviderForAssistant(current) === provider ? current : localAgentDefaultAssistant(provider)
    ))
    if (open) setCodexAgentOpen(true)
  }

  const addCodexAgentFiles = async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return

    const remainingSlots = Math.max(0, CODEX_AGENT_ATTACHMENT_LIMIT - codexAgentAttachments.length)
    const supportedFiles = selectedFiles
      .filter((file) => isImageAttachmentFile(file) || isTextAttachmentFile(file))
      .slice(0, remainingSlots)

    if (supportedFiles.length < selectedFiles.length) {
      setNotice(remainingSlots === 0 ? `Agent can attach up to ${CODEX_AGENT_ATTACHMENT_LIMIT} files.` : 'Only images and text-like files can be attached to the agent.')
    }

    const nextAttachments = await Promise.all(supportedFiles.map(async (file): Promise<CodexAgentAttachmentDraft> => {
      const id = `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`

      if (isImageAttachmentFile(file)) {
        return {
          id,
          kind: 'image',
          name: file.name,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          dataUrl: await readFileAsDataUrl(file)
        }
      }

      const text = await readFileAsTruncatedText(file)

      return {
        id,
        kind: 'text',
        name: file.name,
        mimeType: file.type || 'text/plain',
        sizeBytes: file.size,
        text: text.text,
        truncated: text.truncated
      }
    }))

    setCodexAgentAttachments((current) => [...current, ...nextAttachments])
  }

  const addCodexAgentAttachments = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    await addCodexAgentFiles(selectedFiles)
  }

  const handleCodexAgentPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (codexAgentRunning) return
    const pastedFiles = [
      ...Array.from(event.clipboardData.files ?? []),
      ...filesFromTransferItems(event.clipboardData.items)
    ]
    const uniqueFiles = Array.from(new Map(pastedFiles.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])).values())

    if (!uniqueFiles.some((file) => isImageAttachmentFile(file) || isTextAttachmentFile(file))) {
      return
    }

    event.preventDefault()
    void addCodexAgentFiles(uniqueFiles)
  }

  const handleCodexAgentDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (codexAgentRunning || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleCodexAgentDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (codexAgentRunning) return
    const droppedFiles = [
      ...Array.from(event.dataTransfer.files ?? []),
      ...filesFromTransferItems(event.dataTransfer.items)
    ]
    const uniqueFiles = Array.from(new Map(droppedFiles.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])).values())

    if (!uniqueFiles.some((file) => isImageAttachmentFile(file) || isTextAttachmentFile(file))) {
      return
    }

    event.preventDefault()
    void addCodexAgentFiles(uniqueFiles)
  }

  const removeCodexAgentAttachment = (id: string) => {
    setCodexAgentAttachments((current) => current.filter((attachment) => attachment.id !== id))
    setCodexAgentPreviewAttachment((current) => current?.id === id ? null : current)
  }

  const applyCodexAgentCommand = (command: LocalAgentCommand) => {
    const commandText = command.insert({
      agentLabel: localAgentLabel(codexAgentProvider),
      modelLabel: assistantSelectionLabel(codexAgentAssistant),
      reasoning: codexAgentReasoning,
      access: codexAgentSandbox,
      filePath: selectedPath || undefined
    })
    const nextPrompt = codexAgentPrompt.replace(/(?:^|\n)\/([a-z-]*)$/i, (match) => {
      const prefix = match.startsWith('\n') ? '\n' : ''
      return `${prefix}${commandText}`
    })

    setCodexAgentPrompt(nextPrompt)
    window.setTimeout(() => {
      const textarea = codexAgentTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(nextPrompt.length, nextPrompt.length)
    }, 0)
  }

  const runCodexAgentPanel = async (promptOverride?: string) => {
    if (!api || !currentRepoPath || codexAgentRunning) return
    const providerLabel = localAgentLabel(codexAgentProvider)
    const prompt = (promptOverride ?? codexAgentPrompt).trim()
    if (!prompt && !selectedPath && codexAgentAttachments.length === 0) {
      setCodexAgentError('Enter a prompt, select a file, or attach a file.')
      return
    }

    if (codexAgentSandbox !== 'read-only') {
      const confirmed = await requestConfirmation(
        codexAgentSandbox === 'danger-full-access'
          ? `Run ${providerLabel} with full access? It may edit files, run local commands, and push to remotes if your prompt asks for it.`
          : `Run ${providerLabel} with workspace write access? It may edit files inside this repository.`,
        {
          title: codexAgentSandbox === 'danger-full-access' ? `Run ${providerLabel} Full Access` : `Run ${providerLabel} Locally`,
          confirmLabel: codexAgentSandbox === 'danger-full-access' ? 'Run full access' : 'Run locally',
          variant: 'danger'
        }
      )

      if (!confirmed) return
    }

    const includeFileText = selectedPath && viewMode !== 'image' && viewMode !== 'hex' && !textUnavailableMessage && !fileError
    const fileText = includeFileText ? flushActiveEditorDraftText() : undefined
    const runId = crypto.randomUUID()

    codexAgentRunIdRef.current = runId
    setCodexAgentRunning(true)
    setCodexAgentStopping(false)
    setCodexAgentStopped(false)
    setCodexAgentError(null)
    setCodexAgentResult(null)
    setCodexAgentLiveEvents([])

    const unsubscribe = api.onCodexAgentEvent((batch) => {
      if (batch.runId !== runId) return
      setCodexAgentLiveEvents((current) => appendLiveAgentEvents(current, batch.events))
    })

    try {
      const result = await api.runCodexAgent({
        repoPath: currentRepoPath,
        assistant: localAgentProviderForAssistant(codexAgentAssistant) === codexAgentProvider
          ? codexAgentAssistant
          : localAgentDefaultAssistant(codexAgentProvider),
        prompt,
        filePath: selectedPath || undefined,
        fileText,
        diagnostics: diagnostics.slice(0, 20).map((diagnostic) => ({
          lineNumber: diagnostic.lineNumber,
          column: diagnostic.column,
          message: diagnostic.message,
          source: diagnostic.source
        })),
        sandbox: codexAgentSandbox,
        reasoning: codexAgentReasoning,
        attachments: codexAgentAttachments.map((attachment): CodexAgentAttachment => ({
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          text: attachment.text,
          sizeBytes: attachment.sizeBytes
        })),
        runId
      })

      if (!result.ok) {
        // A stopped run keeps whatever the agent already produced (the live trace)
        // instead of wiping it with an error message.
        if (result.error.code === 'local_agent_cancelled') {
          setCodexAgentStopped(true)
        } else {
          setCodexAgentError(friendlyAgentErrorMessage(result.error, `${providerLabel} agent failed.`))
        }
        return
      }

      setCodexAgentResult(result.data)
      setNotice(`${providerLabel} agent finished in ${Math.max(1, Math.round(result.data.durationMs / 1000))}s.`)

      if (codexAgentSandbox !== 'read-only') {
        await runSnapshotAction(`${providerLabel} agent refreshed repository.`, () => api.refreshRepository(currentRepoPath))
      }
    } catch (error) {
      setCodexAgentError(friendlyIpcErrorMessage(error instanceof Error ? error.message : '', `${providerLabel} agent failed.`))
    } finally {
      unsubscribe()
      codexAgentRunIdRef.current = null
      setCodexAgentRunning(false)
      setCodexAgentStopping(false)
    }
  }

  const stopCodexAgent = () => {
    const runId = codexAgentRunIdRef.current
    if (!api || !runId || codexAgentStopping) return

    setCodexAgentStopping(true)
    void api.cancelCodexAgent(runId)
  }

  // Runs a queued prompt: mirror it into the composer for visibility, then start
  // the run with the explicit text so it does not race the async prompt state.
  const runPromptFromQueue = (text: string) => {
    setCodexAgentPrompt(text)
    void runCodexAgentPanel(text)
  }

  const {
    agentSessionSummaryOpen,
    toggleAgentSessionSummary,
    refreshAgentSessionSummary,
    agentSessionSummary,
    agentSessionSummaryLoading,
    agentSessionSummaryError
  } = useAgentSessionSummary({ api, currentRepoPath })

  const {
    codexAgentQueue,
    codexAgentQueueCount,
    codexAgentQueuePaused,
    codexAgentQueuePauseReason,
    enqueue: enqueueCodexAgentPrompt,
    removeCodexAgentQueueItem,
    clearCodexAgentQueue,
    moveCodexAgentQueueItem,
    pauseCodexAgentQueue,
    resumeCodexAgentQueue
  } = useAgentQueue({
    codexAgentRunning,
    codexAgentResult,
    codexAgentError,
    codexAgentLiveEvents,
    onRunPrompt: runPromptFromQueue
  })

  // "Add to queue": append the composer text (immediately or while a run is active)
  // and clear the composer so the user can line up the next instruction.
  const queueCurrentPrompt = () => {
    const text = codexAgentPrompt.trim()
    if (!text) return
    enqueueCodexAgentPrompt(text)
    setCodexAgentPrompt('')
  }

  return {
    codexAgentTextareaRef,
    codexAgentOpen,
    setCodexAgentOpen,
    codexAgentPrompt,
    setCodexAgentPrompt,
    setCodexAgentPromptFocused,
    codexAgentRunning,
    codexAgentResult,
    codexAgentError,
    codexAgentLiveEvents,
    codexAgentStopping,
    codexAgentStopped,
    stopCodexAgent,
    codexAgentAttachments,
    codexAgentPreviewAttachment,
    setCodexAgentPreviewAttachment,
    codexAgentProvider,
    codexAgentAssistant,
    setCodexAgentAssistant,
    codexAgentReasoning,
    setCodexAgentReasoning,
    codexAgentSandbox,
    setCodexAgentSandbox,
    codexAgentStatusLabel,
    codexAgentStatusMessage,
    codexAgentUsageText,
    codexAgentCommandSuggestions,
    selectLocalAgentProvider,
    addCodexAgentAttachments,
    handleCodexAgentPaste,
    handleCodexAgentDragOver,
    handleCodexAgentDrop,
    removeCodexAgentAttachment,
    applyCodexAgentCommand,
    runCodexAgentPanel,
    codexAgentQueue,
    codexAgentQueueCount,
    codexAgentQueuePaused,
    codexAgentQueuePauseReason,
    queueCurrentPrompt,
    removeCodexAgentQueueItem,
    clearCodexAgentQueue,
    moveCodexAgentQueueItem,
    pauseCodexAgentQueue,
    resumeCodexAgentQueue,
    agentSessionSummaryOpen,
    toggleAgentSessionSummary,
    refreshAgentSessionSummary,
    agentSessionSummary,
    agentSessionSummaryLoading,
    agentSessionSummaryError
  }
}
