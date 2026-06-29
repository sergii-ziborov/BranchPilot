import { FindingCard } from 'branchpilot'

export function Critical() {
  return (
    <FindingCard
      severity="critical"
      title="Hardcoded API token committed to source"
      location="src/lib/githubCliService.ts:142"
      details="A personal access token is embedded as a string literal and shipped in the bundle. Anyone with read access to the repository or the built artifact can extract and reuse it."
      recommendation="Move the token to an environment variable and rotate the leaked credential immediately."
    />
  )
}

export function High() {
  return (
    <FindingCard
      severity="high"
      title="Unawaited promise in commit pipeline"
      location="electron/lib/repositoryService.commits.ts:88"
      details="stageAll() returns a promise that is never awaited, so the commit can run before staging completes and silently drop files from the snapshot."
      recommendation="Await stageAll() before invoking createCommit, or chain the calls in a single async flow."
    />
  )
}

export function Medium() {
  return (
    <FindingCard
      severity="medium"
      title="Diff parser does not handle renames"
      location="electron/lib/repositoryService.parsers.ts:210"
      details="Rename hunks fall through the switch and are reported as a delete plus an add, inflating the changed-file count shown in the Changes view."
    />
  )
}

export function Info() {
  return (
    <FindingCard
      severity="info"
      title="Consider extracting the severity strip"
      details="The severity-count strip is duplicated between ReviewView and PreCommitReviewPanel and could share a presentational component."
    />
  )
}

export function CompactLow() {
  return (
    <FindingCard
      compact
      severity="low"
      title="Magic number for retry backoff"
      location="pre-commit / electron/ipc/handlers/git.ts:54"
      details="The 1500ms retry delay is inlined; promote it to a named constant for readability."
    />
  )
}
