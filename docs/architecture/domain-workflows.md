# Domain Workflows

Use this file for behavior that crosses renderer hooks, IPC handlers and
main-process services. For exact file ownership, start from the main index.[^index]
For directory-level ownership, open the module catalog first.[^modules]

## Repository Open And Refresh

Open flow:

```text
UI action
  -> useRepositoryManagement
  -> api.openRepository / chooseAndOpenRepository / cloneRepository
  -> repository IPC handler
  -> RepositoryService
  -> RepositorySnapshot
  -> useAppController.applySnapshot()
```

Silent refresh is owned by `useAppController`. It polls the active repository and
dashboard state, discards stale results if the user switched repositories, and
does not write activity-log entries.

## Changes, Staging And Commit

Changes UI state lives in `useChanges`; commit composer state lives in
`useCommit`.

Main-process ownership:

- staging/hunk/discard operations: `repositoryService.staging`;
- commits/amend/revert/cherry-pick/reset: `repositoryService.commits`;
- diff reads and file previews: `RepositoryService` query/read methods.

Discard, delete, reset and force-push style actions must keep confirmation at the
UI request boundary and service precondition boundary.

## Branches, Tags, Worktrees And Merge

Renderer hooks:

- `useBranches` owns branch draft UI, descriptions, branch compare, tags and
  worktrees;
- `useMerge` owns merge/rebase start, continue, abort and conflict-side actions.

Main-process services:

- `repositoryService.branches`;
- `repositoryService.worktreeTag`;
- `repositoryService.merge`;
- shared guards from `RepositoryServiceBase`.

When merge conflicts appear, the controller switches users into the Merge view
and `ConflictBanner` stays visible outside that view until the operation ends.

## Providers And Pull Requests

`useProviders` is the renderer owner for GitHub CLI status, accounts, repository
browser, PR list/details/checks/diff and PR creation. Main code delegates to
`electron/providers/githubCliService*.ts`.

Provider credentials are not stored by BranchPilot. GitHub auth is delegated to
existing GitHub CLI or GitHub Desktop credential state.

## Assistants

Assistants are optional and suggestive:

- renderer state lives in `useAssistants`, `useReview`, `useCommit`,
  `useBranches`, `useProviders` and `useLinkedIn`;
- main execution lives in `electron/assistants/assistantRunner*.ts`;
- IPC uses `handleAssistantAction()` for policy and activity logging;
- assistant output is returned to the UI for user review before any Git mutation.

Assistant policy is per repository and should be checked before generation, not
only before writing output.

## Memory, Wiki, Activity And Reports

Project Memory, Project Wiki and Activity Log live under Electron user data:

- services: `projectMemoryService`, `projectWikiService`, `activityLogService`;
- UI hook: `useProjectMemory`;
- report hooks: `useDailyReview`, `useLinkedIn`, dashboard/report state in
  `useRepositoryManagement`.

Activity entries are meaningful workflow records. Avoid logging high-frequency
background reads such as refresh polling.

## Workflow Checklist

1. Identify the renderer hook that owns the interaction.
2. Identify the IPC handler and service that own the operation.
3. Preserve confirmations, preconditions and activity logging.
4. Keep generated assistant/provider text separate from Git mutations.
5. Add tests at the smallest layer that captures the behavior.[^development]

[^index]: [Main architecture index](../../ARCHITECTURE.md)
[^renderer]: [Renderer architecture](renderer.md)
[^main]: [Main process architecture](main-process.md)
[^development]: [Development workflow](development.md)
[^modules]: [Module catalog](../modules/README.md)
