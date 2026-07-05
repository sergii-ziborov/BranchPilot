# Tests Module

Scope: `tests/**` and focused verification commands.[^development]

## Owns

- Unit tests for shared labels, preconditions, parsers and helpers.
- Service workflow tests for repository behavior.
- Component SSR/render tests for critical UI surfaces.
- IPC/channel/security tests.
- Packaging config tests.
- Test fixtures and support helpers under `tests/support/**`.

## Patterns

- Test pure helpers at the pure helper layer.
- Test Git workflows with temporary repositories.
- Keep provider CLI behavior behind fixtures/support helpers.
- Prefer narrow tests before full `npm run test`.

## Does Not Own

- Production source ownership.[^architecture]
- Build scripts beyond assertions.[^scripts]

## Change Notes

- When adding an IPC channel, update channel/API coverage.
- When changing assistant policy actions, update policy tests.
- When adding packaging commands, update packaging config tests.
- Full verification remains `npm run test`, `npm run lint`, `npm run build`.

[^development]: [Development workflow](../architecture/development.md)
[^architecture]: [Architecture index](../../ARCHITECTURE.md)
[^scripts]: [Scripts Packaging](scripts-packaging.md)
