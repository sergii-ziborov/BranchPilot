// Importable-bundle entry for the BranchPilot design-system sync (claude.ai/design).
//
// This file is NOT part of the app build. /design-sync points esbuild's
// `--entry` at it so the bundle contains ONLY the scoped, reusable
// presentational primitives — never the IPC/Electron-coupled views — and so
// esbuild bakes the real app stylesheets (tokens + component classes) into
// _ds_bundle.css straight from source. Keep this list in sync with
// componentSrcMap in .design-sync/config.json.

import './ds-tokens.css'
import '../src/index.css'
import '../src/App.css'

export { Stat, InfoRow } from '../src/components/primitives'
export { PanelHeading } from '../src/components/PanelHeading'
export { EmptyState } from '../src/components/EmptyState'
export { ConflictBanner } from '../src/components/ConflictBanner'
export { BackToChanges } from '../src/components/BackToChanges'
export { ViewSwitch } from '../src/components/ViewSwitch'
export { StageCheckbox, BulkStageCheckbox } from '../src/components/StageCheckbox'
export { BranchPilotMark, BranchPilotLogo, LinkedinIcon } from '../src/components/BrandIcons'
export { ProviderRemoteCard, PlannedProviderWorkflowPanel } from '../src/components/ProviderRemoteCard'
export { Toaster } from '../src/components/Toaster'

// --- Expanded set: reusable primitives extracted from the app's inline UI ---
export { SegmentedControl } from '../src/components/SegmentedControl'
export { IconButton } from '../src/components/IconButton'
export { StatusPill } from '../src/components/StatusPill'
export { CountBadge } from '../src/components/CountBadge'
export { Chip } from '../src/components/Chip'
export { SelectableChipGroup } from '../src/components/SelectableChipGroup'
export { SeverityCountStrip } from '../src/components/SeverityCountStrip'
export { FindingCard } from '../src/components/FindingCard'
export { Avatar } from '../src/components/Avatar'
export { Meter } from '../src/components/Meter'
export { FileStatusToken } from '../src/components/FileStatusToken'
export { FileTypeIcon } from '../src/components/FileTypeIcon'
export { DiffStatBadges } from '../src/components/DiffStatBadges'
export { ActionCard } from '../src/components/ActionCard'
export { ChoiceOptionCard } from '../src/components/ChoiceOptionCard'
export { StatusDot } from '../src/components/StatusDot'
export { CommitRefChip } from '../src/components/CommitRefChip'
export { CopyableCodeBlock } from '../src/components/CopyableCodeBlock'
