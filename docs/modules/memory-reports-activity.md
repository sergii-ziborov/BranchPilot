# Memory Reports Activity Module

Scope: project memory, project wiki, activity log, dashboard analytics, daily
review and report workflows.[^workflows]

## Owns

- `ProjectMemoryService` and project-memory MCP config/server.
- `ProjectWikiService` and wiki page generation from memory snapshots.
- `ActivityLogService` records for user/provider/assistant actions.
- `DailyReviewService`, repository activity analytics and report data.
- Renderer hooks: `useProjectMemory`, `useDailyReview`, `useLinkedIn` and
  dashboard/report portions of repository management.

## Patterns

- Activity log writes should be meaningful and low-noise.
- Background refresh and polling should not create activity entries.
- Memory/wiki generation may read repository content but should not mutate source
  files.
- Report scopes may be single-repository or multi-repository.

## Does Not Own

- Assistant model execution.[^providers]
- Git mutation services.[^services]
- Route shell layout.[^app-shell]

## Change Notes

- Keep generated memory/wiki data under Electron user data.
- Refresh memory after meaningful repository mutations only when needed.
- Test report aggregation and date/window behavior separately from UI layout.

[^workflows]: [Domain workflows](../architecture/domain-workflows.md)
[^providers]: [Providers And Assistants](providers-assistants.md)
[^services]: [Repository Services](repository-services.md)
[^app-shell]: [Renderer App Shell](renderer-app-shell.md)
[^tests]: [Tests](tests.md)
