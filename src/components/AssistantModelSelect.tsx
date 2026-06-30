import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import type { AssistantId, AssistantStatus, InstalledAssistantId } from '../shared/branchPilot'
import { SignalStatus } from './SignalStatus'
import {
  assistantBaseId,
  assistantStatusLabel,
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS
} from '../lib/assistantLabels'
import { autoAssistantLabel, selectedAssistantDescription } from '../lib/assistantSelection'

const ASSISTANT_MODEL_GROUPS: Array<{
  id: InstalledAssistantId
  label: string
  options: Array<{ id: AssistantId; label: string; description: string }>
}> = [
  { id: 'claude', label: 'Claude Code', options: CLAUDE_MODEL_OPTIONS },
  { id: 'codex', label: 'Codex', options: CODEX_MODEL_OPTIONS }
]

export function AssistantModelSelect({
  id,
  label,
  selectedAssistant,
  setSelectedAssistant,
  assistants,
  assistantsChecking,
  checkAssistants
}: {
  id: string
  label: string
  selectedAssistant: AssistantId
  setSelectedAssistant: (assistant: AssistantId) => void
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
}) {
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false)
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

  useEffect(() => {
    if (!assistantMenuOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (assistantMenuRef.current?.contains(event.target as Node)) {
        return
      }

      setAssistantMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistantMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [assistantMenuOpen])

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
            onClick={() => setAssistantMenuOpen((open) => !open)}
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
            className="assistant-check-button assistant-model-refresh-button"
            type="button"
            title="Check assistants"
            aria-label="Check assistants"
            onClick={checkAssistants}
            disabled={assistantsChecking}
          >
            {assistantsChecking ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
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
