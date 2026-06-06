# BranchPilot

BranchPilot is a desktop Git client for local repositories and hosted source providers.

## Development

```sh
npm install
npm run dev
```

## Verification

```sh
npm run test
npm run lint
npm run build
```

## Local macOS Build

```sh
npm run dist
```

The unsigned local build is written to `release/`:

- `release/mac-arm64/BranchPilot.app`
- `release/BranchPilot-0.0.0-arm64.dmg`
- `release/BranchPilot-0.0.0-arm64-mac.zip`

Code signing and notarization are intentionally deferred. For private local testing on macOS, open the app from `release/mac-arm64/BranchPilot.app` or install from the generated DMG.

## Private Beta Smoke

Use [docs/beta-smoke.md](docs/beta-smoke.md) before sharing a build.
