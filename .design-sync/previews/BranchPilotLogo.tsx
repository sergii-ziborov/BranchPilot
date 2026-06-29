import { BranchPilotLogo } from 'branchpilot'

export const Default = () => <BranchPilotLogo size={32} />

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
    <BranchPilotLogo size={20} />
    <BranchPilotLogo size={28} />
    <BranchPilotLogo size={40} />
  </div>
)
