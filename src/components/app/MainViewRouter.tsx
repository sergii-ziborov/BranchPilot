import type { Dispatch, SetStateAction } from 'react'
import { useController } from '../../hooks/AppControllerContext'
import type { ChangesTool } from './AppWorkspace'
import { BranchesRoute } from './routes/BranchesRoute'
import { ChangesRoute } from './routes/ChangesRoute'
import { ConfigRoute } from './routes/ConfigRoute'
import { DashboardRoute } from './routes/DashboardRoute'
import { HistoryRoute } from './routes/HistoryRoute'
import { MergeRoute } from './routes/MergeRoute'
import { ProvidersRoute } from './routes/ProvidersRoute'
import { ReportsRoute } from './routes/ReportsRoute'

interface MainViewRouterProps {
  changesTool: ChangesTool
  setChangesTool: Dispatch<SetStateAction<ChangesTool>>
  onOpenPublishRepository: () => void
}

export function MainViewRouter({ changesTool, setChangesTool, onOpenPublishRepository }: MainViewRouterProps) {
  const { viewMode, snapshot } = useController()

  return (
    <>
      {viewMode === 'dashboard' && <DashboardRoute />}
      {(viewMode === 'changes' || viewMode === 'review') && (
        <ChangesRoute changesTool={changesTool} setChangesTool={setChangesTool} />
      )}
      {viewMode === 'history' && <HistoryRoute />}
      {viewMode === 'merge' && <MergeRoute />}
      {viewMode === 'branches' && snapshot && <BranchesRoute />}
      {viewMode === 'config' && <ConfigRoute />}
      {viewMode === 'providers' && <ProvidersRoute onOpenPublishRepository={onOpenPublishRepository} />}
      {(viewMode === 'daily' || viewMode === 'linkedin' || viewMode === 'memory' || viewMode === 'wiki' || viewMode === 'mcp') && <ReportsRoute />}
    </>
  )
}
