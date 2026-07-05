const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.resolve(__dirname, '..')
const releasePath = path.join(rootPath, 'release')
const productAppName = 'BranchPilot.app'
const dryRun = process.argv.includes('--dry-run')

function findAppBundles(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const apps = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name === productAppName) {
      apps.push(entryPath)
      continue
    }

    if (entry.isDirectory()) {
      apps.push(...findAppBundles(entryPath, depth + 1))
    }
  }

  return apps
}

function newestAppBundle(apps) {
  return apps
    .map((appPath) => ({ appPath, mtimeMs: fs.statSync(appPath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.appPath
}

if (process.platform !== 'darwin') {
  console.error('[open-mac-build] This command only runs on macOS.')
  process.exit(1)
}

const appPath = newestAppBundle(findAppBundles(releasePath))
if (!appPath) {
  console.error('[open-mac-build] No BranchPilot.app found under release/. Run `npm run dist:mac` first.')
  process.exit(1)
}

if (dryRun) {
  console.log(appPath)
  process.exit(0)
}

const result = spawnSync('/usr/bin/open', [appPath], { stdio: 'inherit' })
process.exit(result.status ?? 0)
