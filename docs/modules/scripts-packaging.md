# Scripts Packaging Module

Scope: npm scripts, helper scripts, packaging config and build resources.[^development]

## Owns

- `package.json` scripts.
- `scripts/prepare-dev.cjs`: stale dev-process cleanup before `npm run dev`.
- `scripts/run-electron.cjs`: Electron launch/restart wrapper.
- `scripts/open-mac-build.cjs`: opens newest packaged macOS `.app`.
- `build/icon.*`: electron-builder icons.
- electron-builder config under `package.json`.

## Patterns

- Keep scripts cross-platform unless the script name says otherwise.
- Platform-specific cleanup belongs in scripts or platform helper modules.
- macOS packaged launch uses `start:mac`.
- Windows installer output uses NSIS through `dist:win`.

## Does Not Own

- Runtime Electron app behavior.[^ipc]
- Repository Git behavior.[^services]
- Test implementation beyond packaging assertions.[^tests]

## Change Notes

- Update README when adding a run/build command.
- Update `tests/packagingConfig.test.ts` for package config that should remain
  stable.
- Do not commit `dist`, `dist-electron` or `release` outputs.

[^development]: [Development workflow](../architecture/development.md)
[^ipc]: [Electron IPC](electron-ipc.md)
[^services]: [Repository Services](repository-services.md)
[^tests]: [Tests](tests.md)
