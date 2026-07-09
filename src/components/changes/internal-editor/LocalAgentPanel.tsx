import type {
  ChangeEvent as ReactChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent
} from 'react'
import { BrainCircuit, ChevronDown, ChevronUp, FileCode2, History, ListPlus, Paperclip, PauseCircle, PlayCircle, RefreshCw, SendHorizontal, Square, Trash2, X } from 'lucide-react'
import type { AssistantId, CodexAgentEvent, CodexAgentReasoning, CodexAgentResult, CodexAgentSandbox } from '../../../shared/branchPilot'
import { assistantSelectionLabel } from '../../../lib/assistantLabels'
import { SignalStatus } from '../../SignalStatus'
import { AgentSessionSummary } from './AgentSessionSummary'
import type { AgentSessionSummary as AgentSessionSummaryData } from './agentSessionSummaryData'
import { LocalAgentBrandIcon } from './LocalAgentBrandIcon'
import { useLocalAgentComposerResize } from './useLocalAgentComposerResize'
import {
  CODEX_AGENT_ATTACHMENT_LIMIT,
  CODEX_AGENT_REASONING_OPTIONS,
  CODEX_AGENT_SANDBOX_OPTIONS,
  liveAgentEventLabel,
  localAgentLabel,
  localAgentModelOptions,
  type CodexAgentAttachmentDraft,
  type LocalAgentCommand,
  type LocalAgentProvider,
  type QueuedAgentPrompt
} from './localAgentSupport'

interface LocalAgentPanelProps {
  codexAgentProvider: LocalAgentProvider
  selectedPath: string
  apiReady: boolean
  codexAgentAssistant: AssistantId
  setCodexAgentAssistant: (assistant: AssistantId) => void
  codexAgentReasoning: CodexAgentReasoning
  setCodexAgentReasoning: (reasoning: CodexAgentReasoning) => void
  codexAgentSandbox: CodexAgentSandbox
  setCodexAgentSandbox: (sandbox: CodexAgentSandbox) => void
  codexAgentStatusLabel: string
  codexAgentStatusMessage: string
  codexAgentUsageText: string
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  codexAgentResult: CodexAgentResult | null
  codexAgentError: string | null
  codexAgentRunning: boolean
  codexAgentLiveEvents: CodexAgentEvent[]
  codexAgentStopping: boolean
  codexAgentStopped: boolean
  stopCodexAgent: () => void
  codexAgentPrompt: string
  setCodexAgentPrompt: (prompt: string) => void
  setCodexAgentPromptFocused: (focused: boolean) => void
  codexAgentTextareaRef: { current: HTMLTextAreaElement | null }
  codexAgentCommandSuggestions: LocalAgentCommand[]
  applyCodexAgentCommand: (command: LocalAgentCommand) => void
  codexAgentAttachments: CodexAgentAttachmentDraft[]
  codexAgentPreviewAttachment: CodexAgentAttachmentDraft | null
  setCodexAgentPreviewAttachment: (attachment: CodexAgentAttachmentDraft | null) => void
  removeCodexAgentAttachment: (id: string) => void
  addCodexAgentAttachments: (event: ReactChangeEvent<HTMLInputElement>) => Promise<void>
  handleCodexAgentPaste: (event: ReactClipboardEvent<HTMLElement>) => void
  handleCodexAgentDragOver: (event: ReactDragEvent<HTMLElement>) => void
  handleCodexAgentDrop: (event: ReactDragEvent<HTMLElement>) => void
  runCodexAgentPanel: () => Promise<void>
  codexAgentQueue: QueuedAgentPrompt[]
  codexAgentQueueCount: number
  codexAgentQueuePaused: boolean
  codexAgentQueuePauseReason: string | null
  queueCurrentPrompt: () => void
  removeCodexAgentQueueItem: (id: string) => void
  clearCodexAgentQueue: () => void
  moveCodexAgentQueueItem: (id: string, direction: 'up' | 'down') => void
  pauseCodexAgentQueue: () => void
  resumeCodexAgentQueue: () => void
  agentSessionSummaryOpen: boolean
  toggleAgentSessionSummary: () => void
  refreshAgentSessionSummary: () => void
  agentSessionSummary: AgentSessionSummaryData
  agentSessionSummaryLoading: boolean
  agentSessionSummaryError: string | null
  onClose: () => void
}

export function LocalAgentPanel({
  codexAgentProvider,
  selectedPath,
  apiReady,
  codexAgentAssistant,
  setCodexAgentAssistant,
  codexAgentReasoning,
  setCodexAgentReasoning,
  codexAgentSandbox,
  setCodexAgentSandbox,
  codexAgentStatusLabel,
  codexAgentStatusMessage,
  codexAgentUsageText,
  assistantsChecking,
  checkAssistants,
  codexAgentResult,
  codexAgentError,
  codexAgentRunning,
  codexAgentLiveEvents,
  codexAgentStopping,
  codexAgentStopped,
  stopCodexAgent,
  codexAgentPrompt,
  setCodexAgentPrompt,
  setCodexAgentPromptFocused,
  codexAgentTextareaRef,
  codexAgentCommandSuggestions,
  applyCodexAgentCommand,
  codexAgentAttachments,
  codexAgentPreviewAttachment,
  setCodexAgentPreviewAttachment,
  removeCodexAgentAttachment,
  addCodexAgentAttachments,
  handleCodexAgentPaste,
  handleCodexAgentDragOver,
  handleCodexAgentDrop,
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
  agentSessionSummaryError,
  onClose
}: LocalAgentPanelProps) {
  const {
    bodyRef,
    composerWidth,
    composerStyle,
    startComposerResize,
    handleComposerResizeKeyDown,
    minComposerWidth,
    maxComposerWidth
  } = useLocalAgentComposerResize()

  return (
    <section className="changes-editor-codex-panel" aria-label={`${localAgentLabel(codexAgentProvider)} agent`}>
      <header className="changes-editor-codex-head">
        <div>
          <LocalAgentBrandIcon provider={codexAgentProvider} size={34} />
          <div>
            <strong>{localAgentLabel(codexAgentProvider)} agent</strong>
            <span>{selectedPath || 'Repository context'}</span>
          </div>
        </div>
        <div className="changes-editor-codex-inline-controls">
          <label>
            <span>Model</span>
            <select value={codexAgentAssistant} onChange={(event) => setCodexAgentAssistant(event.currentTarget.value as AssistantId)}>
              {localAgentModelOptions(codexAgentProvider).map((option) => (
                <option key={option.id} value={option.id}>{assistantSelectionLabel(option.id)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select value={codexAgentReasoning} onChange={(event) => setCodexAgentReasoning(event.currentTarget.value as CodexAgentReasoning)}>
              {CODEX_AGENT_REASONING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Access</span>
            <select value={codexAgentSandbox} onChange={(event) => setCodexAgentSandbox(event.currentTarget.value as CodexAgentSandbox)}>
              {CODEX_AGENT_SANDBOX_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`changes-editor-codex-usage status-${codexAgentStatusLabel}`}
            onClick={() => void checkAssistants()}
            disabled={assistantsChecking}
            title={codexAgentStatusMessage}
            aria-label={`Refresh ${localAgentLabel(codexAgentProvider)} usage status`}
          >
            <span>Usage</span>
            <strong>{codexAgentUsageText}</strong>
            <RefreshCw className={assistantsChecking ? 'spin' : ''} size={13} />
          </button>
        </div>
        <div className="changes-editor-codex-head-actions">
          {codexAgentResult && (
            <span className="changes-editor-codex-meta">
              {Math.max(1, Math.round(codexAgentResult.durationMs / 1000))}s - {codexAgentResult.sandbox}
            </span>
          )}
          <button type="button" className="compact-icon" onClick={() => onClose()} title={`Close ${localAgentLabel(codexAgentProvider)} agent`} aria-label={`Close ${localAgentLabel(codexAgentProvider)} agent`}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="changes-editor-codex-body" ref={bodyRef} style={composerStyle}>
        <div
          className="changes-editor-codex-composer"
          onDragOver={handleCodexAgentDragOver}
          onDrop={handleCodexAgentDrop}
          onPaste={handleCodexAgentPaste}
        >
          <textarea
            ref={codexAgentTextareaRef}
            value={codexAgentPrompt}
            onChange={(event) => setCodexAgentPrompt(event.currentTarget.value)}
            onFocus={() => setCodexAgentPromptFocused(true)}
            onBlur={() => window.setTimeout(() => setCodexAgentPromptFocused(false), 120)}
            placeholder={`Ask ${localAgentLabel(codexAgentProvider)} about this file, attach screenshots, or ask it to make a local change.`}
            rows={4}
            disabled={codexAgentRunning}
          />
          {codexAgentCommandSuggestions.length > 0 && (
            <div className="changes-editor-codex-command-menu" role="listbox" aria-label="Agent commands">
              {codexAgentCommandSuggestions.map((command) => (
                <button
                  type="button"
                  key={command.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyCodexAgentCommand(command)}
                >
                  <strong>{command.label}</strong>
                  <span>{command.detail}</span>
                </button>
              ))}
            </div>
          )}
          <div className="changes-editor-codex-attachments">
            {codexAgentAttachments.map((attachment) => (
              <span
                className={`changes-editor-codex-attachment attachment-${attachment.kind}${codexAgentPreviewAttachment?.id === attachment.id ? ' active' : ''}`}
                key={attachment.id}
              >
                <button
                  type="button"
                  className="changes-editor-codex-attachment-preview"
                  onClick={() => setCodexAgentPreviewAttachment(attachment)}
                  title={`Preview ${attachment.name}`}
                >
                  {attachment.kind === 'image' && attachment.dataUrl
                    ? <img src={attachment.dataUrl} alt="" aria-hidden="true" />
                    : <FileCode2 size={14} aria-hidden="true" />}
                  <span className="changes-editor-codex-attachment-name">{attachment.name}{attachment.truncated ? ' (truncated)' : ''}</span>
                </button>
                <button type="button" className="changes-editor-codex-attachment-remove" onClick={() => removeCodexAgentAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          {codexAgentPreviewAttachment && (
            <div className="changes-editor-codex-preview">
              <header>
                <strong>{codexAgentPreviewAttachment.name}</strong>
                <button type="button" onClick={() => setCodexAgentPreviewAttachment(null)} aria-label="Close attachment preview">
                  <X size={13} />
                </button>
              </header>
              {codexAgentPreviewAttachment.kind === 'image' && codexAgentPreviewAttachment.dataUrl ? (
                <img src={codexAgentPreviewAttachment.dataUrl} alt={codexAgentPreviewAttachment.name} />
              ) : (
                <pre>{codexAgentPreviewAttachment.text || '(empty file)'}</pre>
              )}
            </div>
          )}
          <footer>
            <label className="changes-editor-codex-upload">
              <input type="file" multiple onChange={addCodexAgentAttachments} disabled={codexAgentRunning || codexAgentAttachments.length >= CODEX_AGENT_ATTACHMENT_LIMIT} />
              <Paperclip size={15} />
              <span>{codexAgentAttachments.length ? `${codexAgentAttachments.length}/${CODEX_AGENT_ATTACHMENT_LIMIT} files` : 'Files'}</span>
            </label>
            <span className="changes-editor-codex-context">
              <Paperclip size={14} />
              {selectedPath ? 'file + diagnostics' : 'repo context'}
            </span>
            {codexAgentRunning && (
              <button
                type="button"
                className="changes-editor-codex-stop"
                onClick={stopCodexAgent}
                disabled={codexAgentStopping}
                title={`Stop ${localAgentLabel(codexAgentProvider)} agent`}
              >
                <Square size={13} />
                {codexAgentStopping ? 'Stopping...' : 'Stop'}
              </button>
            )}
            <button
              type="button"
              className="changes-editor-codex-queue-add"
              onClick={queueCurrentPrompt}
              disabled={!codexAgentPrompt.trim()}
              title="Add this prompt to the queue to run after the current run"
            >
              <ListPlus size={15} />
              Add to queue
            </button>
            <button
              type="button"
              className="changes-editor-codex-run"
              onClick={runCodexAgentPanel}
              disabled={codexAgentRunning || !apiReady}
            >
              {codexAgentRunning ? <RefreshCw className="spin" size={15} /> : <SendHorizontal size={15} />}
              {codexAgentRunning ? 'Running...' : `Run ${localAgentLabel(codexAgentProvider)}`}
            </button>
          </footer>

          {(codexAgentQueue.length > 0 || codexAgentQueuePaused) && (
            <div className="changes-editor-codex-queue">
              <div className="changes-editor-codex-queue-head">
                <strong>Queue</strong>
                <span className="changes-editor-codex-queue-count" aria-label={`${codexAgentQueueCount} queued prompts`}>{codexAgentQueueCount}</span>
                <div className="changes-editor-codex-queue-controls">
                  {codexAgentQueuePaused ? (
                    <button type="button" onClick={resumeCodexAgentQueue} title="Resume the queue">
                      <PlayCircle size={14} />
                      Resume
                    </button>
                  ) : (
                    <button type="button" onClick={pauseCodexAgentQueue} disabled={codexAgentQueue.length === 0} title="Pause auto-running the queue">
                      <PauseCircle size={14} />
                      Pause
                    </button>
                  )}
                  <button type="button" onClick={clearCodexAgentQueue} disabled={codexAgentQueue.length === 0} title="Remove all queued prompts">
                    <Trash2 size={14} />
                    Clear
                  </button>
                </div>
              </div>
              {codexAgentQueuePaused && (
                <div className="changes-editor-codex-queue-paused" role="status">
                  <PauseCircle size={14} />
                  <span>Paused — {codexAgentQueuePauseReason ?? 'usage or rate limit reached'}</span>
                </div>
              )}
              <ol className="changes-editor-codex-queue-list">
                {codexAgentQueue.map((item, index) => (
                  <li key={item.id} className="changes-editor-codex-queue-item">
                    <span className="changes-editor-codex-queue-index">{index + 1}</span>
                    <span className="changes-editor-codex-queue-text" title={item.text}>{item.text}</span>
                    <span className="changes-editor-codex-queue-item-actions">
                      <button type="button" onClick={() => moveCodexAgentQueueItem(item.id, 'up')} disabled={index === 0} aria-label={`Move queued prompt ${index + 1} up`}>
                        <ChevronUp size={13} />
                      </button>
                      <button type="button" onClick={() => moveCodexAgentQueueItem(item.id, 'down')} disabled={index === codexAgentQueue.length - 1} aria-label={`Move queued prompt ${index + 1} down`}>
                        <ChevronDown size={13} />
                      </button>
                      <button type="button" onClick={() => removeCodexAgentQueueItem(item.id)} aria-label={`Remove queued prompt ${index + 1}`}>
                        <X size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div
          className="changes-editor-codex-splitter"
          role="separator"
          aria-label="Resize prompt and output panels"
          aria-orientation="vertical"
          aria-valuemin={minComposerWidth}
          aria-valuemax={maxComposerWidth}
          aria-valuenow={composerWidth}
          tabIndex={0}
          onPointerDown={startComposerResize}
          onKeyDown={handleComposerResizeKeyDown}
        >
          <span />
        </div>

        <div className="changes-editor-codex-output">
          <header>
            <BrainCircuit size={15} />
            <span>{codexAgentRunning ? 'Working' : codexAgentStopped ? 'Stopped' : codexAgentResult ? 'Result' : 'Ready'}</span>
            <button
              type="button"
              className={`changes-editor-codex-summary-toggle${agentSessionSummaryOpen ? ' is-open' : ''}`}
              onClick={toggleAgentSessionSummary}
              aria-expanded={agentSessionSummaryOpen}
              title="Recap of this session's agent runs"
            >
              <History size={13} />
              Session summary
            </button>
          </header>
          <div className="changes-editor-codex-output-body">
          {agentSessionSummaryOpen && (
            <AgentSessionSummary
              summary={agentSessionSummary}
              loading={agentSessionSummaryLoading}
              error={agentSessionSummaryError}
              onRefresh={refreshAgentSessionSummary}
            />
          )}
          {codexAgentError ? (
            <div className="changes-editor-codex-error">{codexAgentError}</div>
          ) : codexAgentRunning ? (
            codexAgentLiveEvents.length > 0 ? (
              <div className="changes-editor-codex-live" aria-live="polite">
                {[...codexAgentLiveEvents].reverse().map((event, index) => (
                  <article key={`${codexAgentLiveEvents.length - index}`} className={`codex-live-event codex-live-${event.type}`}>
                    <strong>{liveAgentEventLabel(event.type)}</strong>
                    <pre>{event.text}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <SignalStatus className="codex-agent-curtain" label={`Running ${localAgentLabel(codexAgentProvider)}`} detail={`${assistantSelectionLabel(codexAgentAssistant)} - ${codexAgentSandbox}`} />
            )
          ) : codexAgentStopped ? (
            <div className="changes-editor-codex-live changes-editor-codex-stopped" aria-live="polite">
              <div className="changes-editor-codex-stopped-note">Agent stopped — showing what it produced before stopping.</div>
              {codexAgentLiveEvents.length > 0 ? (
                [...codexAgentLiveEvents].reverse().map((event, index) => (
                  <article key={`${codexAgentLiveEvents.length - index}`} className={`codex-live-event codex-live-${event.type}`}>
                    <strong>{liveAgentEventLabel(event.type)}</strong>
                    <pre>{event.text}</pre>
                  </article>
                ))
              ) : (
                <div className="changes-editor-codex-stopped-empty">Agent run was stopped before it produced any output.</div>
              )}
            </div>
          ) : codexAgentResult ? (
            <>
              <pre>{codexAgentResult.output}</pre>
              {codexAgentResult.events.length > 0 && (
                <details className="changes-editor-codex-trace">
                  <summary>Trace - {codexAgentResult.events.length}</summary>
                  <div>
                    {codexAgentResult.events.map((event, index) => (
                      <article key={`${event.type}-${index}`}>
                        <strong>{event.type}</strong>
                        <span>{event.text}</span>
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="changes-editor-codex-empty">
              <LocalAgentBrandIcon provider={codexAgentProvider} size={58} />
              <span>{assistantSelectionLabel(codexAgentAssistant)} - {codexAgentReasoning}</span>
            </div>
          )}
          </div>
        </div>
      </div>
    </section>
  )
}
