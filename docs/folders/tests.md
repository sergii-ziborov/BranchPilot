# Test Folders

Scope: `tests` and test support folders.

| Folder | Role | Related |
| --- | --- | --- |
| `tests` | Vitest tests for shared helpers, renderer behavior, IPC contracts, services, provider adapters and packaging config. | [Tests module](../modules/tests.md) |
| `tests/support` | Shared fixtures and helpers for GitHub CLI, assistant runner and repository service tests. | [Providers Assistants](../modules/providers-assistants.md) |

## Maintenance Notes

- Keep fixtures in `tests/support` when multiple tests need them.
- Prefer narrow test files matching the source module name.
- Use full `npm run test` before handoff when behavior changes.

[^tests]: [Tests module](../modules/tests.md)
