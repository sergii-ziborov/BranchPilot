import { ToolModal } from './ToolModal'
import { BranchPilotMark } from './BrandIcons'

interface AboutBranchPilotModalProps {
  appVersion: string
  onClose(): void
}

export function AboutBranchPilotModal({ appVersion, onClose }: AboutBranchPilotModalProps) {
  return (
    <ToolModal title="About BranchPilot" className="about-modal" onClose={onClose}>
      <section className="about-panel">
        <div className="about-brand">
          <BranchPilotMark size={56} />
          <div>
            <h3>BranchPilot</h3>
            <p>Version {appVersion}</p>
          </div>
        </div>
        <p className="about-copy">A local-first Git desktop client for branches, diffs, reviews, and pull requests.</p>
        <div className="about-meta">
          <span>MIT License</span>
          <span>Built by Serhii Ziborov</span>
        </div>
      </section>
    </ToolModal>
  )
}
