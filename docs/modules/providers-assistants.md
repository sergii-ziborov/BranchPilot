# Providers And Assistants Module

Scope: `electron/providers/**`, `electron/assistants/**`, provider hooks and
assistant-related renderer hooks.[^workflows]

## Owns

- GitHub CLI auth/status, repository browser, PR list/details/checks/diff and PR
  creation.
- Provider adapter status.
- Assistant discovery, command execution, prompt context, parsing and generated
  outputs.
- Assistant policy status and action labels.

## Patterns

- Provider credentials stay outside BranchPilot; use GitHub CLI or existing Git
  credential state.
- Assistant actions are suggestive and must pass `handleAssistantAction` policy
  checks.[^ipc]
- Generated text should return to the UI for user review before Git mutation.
- Keep provider parsers pure and covered by tests.

## Does Not Own

- Generic Git repository mutations.[^services]
- Project memory storage.[^memory]
- View layout outside provider/assistant surfaces.[^ui]

## Change Notes

- Add a new assistant action to shared types, policy labels, IPC and tests.
- Preserve activity log metadata for generated artifacts and provider actions.
- Do not grant file-write or command permissions through policy without a
  deliberate product change.

[^workflows]: [Domain workflows](../architecture/domain-workflows.md)
[^ipc]: [Electron IPC](electron-ipc.md)
[^services]: [Repository Services](repository-services.md)
[^memory]: [Memory Reports Activity](memory-reports-activity.md)
[^ui]: [Renderer UI Components](renderer-ui-components.md)
