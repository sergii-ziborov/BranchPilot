import { StatusDot } from 'branchpilot'

export const LabeledStates = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <StatusDot state="ready" label="Claude Code - ready" />
    <StatusDot state="detected" label="Cursor - detected" />
    <StatusDot state="limited" label="GitHub Copilot - rate limited" />
    <StatusDot state="unavailable" label="Codex - unavailable" />
    <StatusDot state="missing" label="Gemini CLI - not installed" />
  </div>
)

export const ChoiceVariant = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <StatusDot variant="choice" state="ready" label="Default assistant" />
    <StatusDot variant="choice" state="detected" label="Auto-detected on PATH" />
    <StatusDot variant="choice" state="missing" label="Binary not found" />
  </div>
)

export const BareDots = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <StatusDot state="ready" />
    <StatusDot state="detected" />
    <StatusDot state="limited" />
    <StatusDot state="unavailable" />
    <StatusDot state="missing" />
  </div>
)
