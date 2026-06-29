import { PanelHeading } from 'branchpilot'

export const Default = () => (
  <PanelHeading title="Changes" description="Review and stage your working-tree changes before committing." />
)

export const Compact = () => <PanelHeading title="History" compact />

export const WithActions = () => (
  <PanelHeading title="Branches" description="Local and remote branches in this repository.">
    <button type="button" className="secondary">New branch</button>
  </PanelHeading>
)
