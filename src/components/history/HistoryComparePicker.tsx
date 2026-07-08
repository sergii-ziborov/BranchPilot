import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { CommitSummary } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import {
  filterCompareBranchCandidates,
  filterCompareCommitCandidates,
  type CompareBranchCandidate
} from './historyCompareCandidates'

interface HistoryComparePickerProps {
  history: CommitSummary[]
  selectedCommitSha: string
  allBranchCandidates: CompareBranchCandidate[]
  compareSha: string
  compareTargetLabel: string
  compareTargetDetail: string
  onChooseCompareTarget: (value: string) => void
}

export function HistoryComparePicker({
  history,
  selectedCommitSha,
  allBranchCandidates,
  compareSha,
  compareTargetLabel,
  compareTargetDetail,
  onChooseCompareTarget
}: HistoryComparePickerProps) {
  const comparePickerRef = useRef<HTMLDivElement | null>(null)
  const [compareQuery, setCompareQuery] = useState('')
  const [comparePickerOpen, setComparePickerOpen] = useState(false)

  const compareQueryText = compareQuery.trim().toLowerCase()
  const compareBranchCandidates = useMemo(
    () => filterCompareBranchCandidates(allBranchCandidates, compareQueryText),
    [allBranchCandidates, compareQueryText]
  )
  const compareCandidates = useMemo(
    () => filterCompareCommitCandidates(history, selectedCommitSha, compareQueryText),
    [compareQueryText, selectedCommitSha, history]
  )

  const chooseCompareTarget = (value: string) => {
    onChooseCompareTarget(value)
    setCompareQuery('')
    setComparePickerOpen(false)
  }

  useEffect(() => {
    if (!comparePickerOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !comparePickerRef.current?.contains(target)) setComparePickerOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setComparePickerOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [comparePickerOpen])

  return (
    <div className="history-preview-compare" ref={comparePickerRef}>
      <div className={comparePickerOpen ? 'history-compare-combobox open' : 'history-compare-combobox'}>
        <Search size={14} />
        <input
          value={compareQuery}
          onFocus={() => setComparePickerOpen(true)}
          onChange={(event) => {
            setCompareQuery(event.target.value)
            setComparePickerOpen(true)
          }}
          placeholder="Search branch or commit to compare"
        />
        <button
          type="button"
          title={compareTargetDetail}
          onClick={() => setComparePickerOpen((open) => !open)}
        >
          <span>{compareTargetLabel}</span>
          <ChevronDown size={14} />
        </button>
      </div>
      {comparePickerOpen && (
        <div className="history-compare-menu" role="listbox">
          <button
            type="button"
            className={!compareSha ? 'selected' : ''}
            onClick={() => chooseCompareTarget('')}
          >
            <strong>Full file at this commit</strong>
            <span>Selected commit</span>
          </button>
          {compareBranchCandidates.length > 0 && <div className="history-compare-menu-group">Branches</div>}
          {compareBranchCandidates.map((branch) => (
            <button
              type="button"
              key={`${branch.kind}-${branch.value}`}
              className={compareSha === branch.value ? 'selected' : ''}
              onClick={() => chooseCompareTarget(branch.value)}
            >
              <strong>{branch.label}</strong>
              <span>{branch.kind}</span>
            </button>
          ))}
          {compareCandidates.length > 0 && <div className="history-compare-menu-group">Commits</div>}
          {compareCandidates.map((commit) => (
            <button
              type="button"
              key={commit.sha}
              className={compareSha === commit.sha ? 'selected' : ''}
              onClick={() => chooseCompareTarget(commit.sha)}
            >
              <strong>{commit.shortSha} - {commit.subject || '(no subject)'}</strong>
              <span>{commit.authorName} | {formatDate(commit.authoredAt)}</span>
            </button>
          ))}
          {compareBranchCandidates.length === 0 && compareCandidates.length === 0 && (
            <div className="history-compare-menu-empty">No branch or commit matches this search.</div>
          )}
        </div>
      )}
    </div>
  )
}
