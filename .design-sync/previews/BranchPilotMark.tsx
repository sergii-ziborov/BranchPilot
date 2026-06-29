import { BranchPilotMark } from 'branchpilot'

export const Default = () => <BranchPilotMark size={48} />

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <BranchPilotMark size={24} />
    <BranchPilotMark size={40} />
    <BranchPilotMark size={64} />
  </div>
)
