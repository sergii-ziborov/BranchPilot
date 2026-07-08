export type HistorySearchMode = 'commit' | 'files' | 'changes' | 'all'

export function historySearchIndexingLabel(historySearchMode: HistorySearchMode): string {
  return historySearchMode === 'changes' ? 'Indexing changes...' :
    historySearchMode === 'all' ? 'Indexing history...' : 'Indexing files...'
}
