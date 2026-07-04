import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, ScrollText } from 'lucide-react'
import { reviewPromptPreview, type AssistantId, type AssistantStatus, type InstalledAssistantId } from '../shared/branchPilot'
import { SignalStatus } from './SignalStatus'
import {
  assistantBaseId,
  assistantStatusLabel,
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS
} from '../lib/assistantLabels'
import { autoAssistantLabel, selectedAssistantDescription } from '../lib/assistantSelection'
import { reviewModeLabel, reviewModes } from '../lib/reviewLabels'

const ASSISTANT_MODEL_GROUPS: Array<{
  id: InstalledAssistantId
  label: string
  options: Array<{ id: AssistantId; label: string; description: string }>
}> = [
  { id: 'claude', label: 'Claude Code', options: CLAUDE_MODEL_OPTIONS },
  { id: 'codex', label: 'Codex', options: CODEX_MODEL_OPTIONS }
]

export interface AssistantPromptPreview {
  id: string
  title: string
  subtitle: string
  body: string
}

export function AssistantModelSelect({
  id,
  label,
  selectedAssistant,
  setSelectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants,
  prompts,
  onCopyPrompt,
  promptsAriaLabel = 'Generation prompts'
}: {
  id: string
  label: string
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  prompts?: AssistantPromptPreview[]
  onCopyPrompt?: (body: string, label: string) => void | Promise<void>
  promptsAriaLabel?: string
}) {
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
  const [promptsOpen, setPromptsOpen] = useState(false)
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({})
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)
  const assistantMenuRef = useRef<HTMLDivElement | null>(null)
  const assistantStatuses = new Map<InstalledAssistantId, AssistantStatus>(assistants.map((assistant) => [assistant.id, assistant]))
  const readyAssistant = assistants.find((assistant) => assistant.state === 'ready')
  const selectedAssistantBaseId = assistantBaseId(selectedAssistant)
  const selectedAssistantStatus = selectedAssistantBaseId === 'auto'
    ? readyAssistant ?? assistants.find((assistant) => assistant.state === 'detected') ?? assistants[0]
    : assistantStatuses.get(selectedAssistantBaseId)
  const assistantSelectState = assistantVisualState(selectedAssistantStatus)
  const selectedAssistantCopy = selectedAssistantDescription(selectedAssistant, readyAssistant, assistants)
  const selectedAssistantStatusLabel = selectedAssistantStatus ? assistantStatusLabel(selectedAssistantStatus) : 'not loaded'
  const defaultPromptPreviews = useMemo(() => reviewModes.map((mode) => ({
    id: mode,
    title: reviewModeLabel(mode),
    subtitle: mode,
    body: reviewPromptPreview(mode)
  })), [])
  const promptPreviews = prompts ?? defaultPromptPreviews

  useEffect(() => {
    setPromptDrafts(Object.fromEntries(promptPreviews.map((prompt) => [prompt.id, prompt.body])))
  }, [promptPreviews])

  useEffect(() => {
    if (!assistantMenuOpen && !promptsOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (assistantMenuRef.current?.contains(event.target as Node)) {
        return
      }

      setAssistantMenuOpen(false)
      setPromptsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistantMenuOpen(false)
        setPromptsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [assistantMenuOpen, promptsOpen])

  const toggleAssistantMenu = () => {
    setAssistantMenuOpen((open) => {
      const nextOpen = !open
      if (nextOpen) {
        setPromptsOpen(false)
        if (!assistantsChecking) {
          void checkAssistants()
        }
      }
      return nextOpen
    })
  }

  const togglePrompts = () => {
    setPromptsOpen((open) => !open)
    setAssistantMenuOpen(false)
  }

  const copyPrompt = async (prompt: AssistantPromptPreview) => {
    const body = promptDrafts[prompt.id] ?? prompt.body

    if (onCopyPrompt) {
      await onCopyPrompt(body, `${prompt.title} prompt`)
    } else {
      await navigator.clipboard.writeText(body)
    }

    setCopiedPromptId(prompt.id)
    window.setTimeout(() => setCopiedPromptId((current) => current === prompt.id ? null : current), 1400)
  }

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="assistant-select-row">
        <div className="assistant-model-menu" ref={assistantMenuRef}>
          <button
            id={id}
            aria-expanded={assistantMenuOpen}
            aria-haspopup="listbox"
            className={`assistant-select assistant-model-trigger assistant-select-${assistantSelectState}`}
            type="button"
            onClick={toggleAssistantMenu}
          >
            <span className={`assistant-model-dot state-${assistantSelectState}`} />
            <span className="assistant-model-trigger-copy">
              <strong>{selectedAssistantCopy.title}</strong>
              <span>{selectedAssistantCopy.meta}</span>
            </span>
            <small className={`assistant-model-status trigger-state state-${assistantSelectState}`}>
              {selectedAssistantStatusLabel}
            </small>
            <ChevronDown size={16} />
          </button>
          <button
            className="assistant-check-button assistant-model-prompts-button"
            type="button"
            title="Review prompts"
            aria-label="Review prompts"
            aria-expanded={promptsOpen}
            aria-haspopup="dialog"
            onClick={togglePrompts}
          >
            <ScrollText size={15} />
            <span>Prompts</span>
          </button>
          {assistantMenuOpen && (
            <div className="assistant-model-popover">
              <div className="assistant-model-list-shell">
                <div className="assistant-model-list" role="listbox" aria-label="Assistant and model">
                  <AssistantModelOption
                    title="Auto"
                    meta={autoAssistantLabel(readyAssistant, assistants)}
                    selected={selectedAssistant === 'auto'}
                    state={assistantSelectState}
                    onSelect={() => {
                      setSelectedAssistant('auto')
                      setAssistantMenuOpen(false)
                    }}
                  />
                  {ASSISTANT_MODEL_GROUPS.map((group) => {
                    const status = assistantStatuses.get(group.id)
                    const state = assistantVisualState(status)

                    return (
                      <section className="assistant-model-group" key={group.id}>
                        <div className="assistant-model-group-heading">
                          <span>{group.label}</span>
                          <small className={`assistant-model-status state-${state}`}>
                            {status ? assistantStatusLabel(status) : 'not loaded'}
                          </small>
                        </div>
                        <div className="assistant-model-options">
                          {group.options.map((option) => (
                            <AssistantModelOption
                              title={option.label}
                              meta={option.description}
                              key={option.id}
                              selected={selectedAssistant === option.id}
                              state={state}
                              onSelect={() => {
                                setSelectedAssistant(option.id)
                                setAssistantMenuOpen(false)
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
                {assistantsChecking && (
                  <SignalStatus
                    compact
                    className="assistant-model-list-curtain"
                    label="Checking assistants"
                    detail="BranchPilot"
                  />
                )}
              </div>
            </div>
          )}
          {promptsOpen && (
            <div className="assistant-model-popover assistant-prompts-popover" role="dialog" aria-label={promptsAriaLabel}>
              <div className="assistant-prompts-list">
                {promptPreviews.map((prompt) => (
                  <article className="assistant-prompt-card" key={prompt.id}>
                    <header>
                      <div>
                        <strong>{prompt.title}</strong>
                        <span>{prompt.subtitle}</span>
                      </div>
                      <button type="button" onClick={() => void copyPrompt(prompt)}>
                        <Copy size={14} />
                        {copiedPromptId === prompt.id ? 'Copied' : 'Copy'}
                      </button>
                    </header>
                    <textarea
                      aria-label={`${prompt.title} prompt`}
                      spellCheck={false}
                      value={promptDrafts[prompt.id] ?? prompt.body}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value
                        setPromptDrafts((drafts) => ({ ...drafts, [prompt.id]: nextValue }))
                      }}
                    />
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function AssistantModelOption({
  title,
  meta,
  selected,
  state,
  onSelect
}: {
  title: string
  meta: string
  selected: boolean
  state: string
  onSelect: () => void
}) {
  return (
    <button
      aria-selected={selected}
      className={`assistant-model-option state-${state} ${selected ? 'active' : ''}`.trim()}
      role="option"
      type="button"
      onClick={onSelect}
    >
      <span className={`assistant-model-dot state-${state}`} />
      <span className="assistant-model-copy">
        <strong>{title}</strong>
        <span>{meta}</span>
      </span>
      {selected && <Check size={15} />}
    </button>
  )
}

function assistantVisualState(status?: AssistantStatus): string {
  if (!status) {
    return 'missing'
  }

  const label = assistantStatusLabel(status)

  if (label === 'limited') {
    return 'limited'
  }

  return status.state
}
