const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const electronPath = require('electron')

for (const key of Object.keys(process.env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
    delete process.env[key]
  }
}

const rawArgs = process.argv.slice(2)
const watch = rawArgs[0] === '--watch'
const electronArgs = watch ? rawArgs.slice(1) : rawArgs
let child = null
let restarting = false
let restartTimer = null

function spawnElectron() {
  child = spawn(electronPath, electronArgs, {
    env: process.env,
    stdio: 'inherit',
    windowsHide: false
  })

  child.on('exit', (code, signal) => {
    child = null
    if (restarting) return

    if (signal && !watch) {
      process.kill(process.pid, signal)
      return
    }

    if (!watch) process.exit(code ?? 0)
    console.log(`[run-electron] Electron exited with code ${code ?? signal ?? 0}; waiting for changes.`)
  })

  child.on('error', (error) => {
    console.error(error)
    if (!watch) process.exit(1)
  })
}

function restartElectron(reason) {
  if (!watch) return
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    console.log(`[run-electron] Restarting Electron after ${reason}.`)
    restarting = true
    const previous = child

    const startNext = () => {
      restarting = false
      spawnElectron()
    }

    if (!previous) {
      startNext()
      return
    }

    previous.once('exit', startNext)
    previous.kill()
  }, 650)
}

function watchDistElectron() {
  const target = path.resolve(process.cwd(), 'dist-electron')
  if (!fs.existsSync(target)) return

  fs.watch(target, { recursive: true }, (_eventType, fileName) => {
    const name = String(fileName ?? '')
    if (!name || name.endsWith('.map')) return
    restartElectron(name)
  })
}

function stop() {
  if (restartTimer) clearTimeout(restartTimer)
  if (child) child.kill()
}

process.on('SIGINT', () => {
  stop()
  process.exit(130)
})
process.on('SIGTERM', () => {
  stop()
  process.exit(143)
})

if (watch) watchDistElectron()
spawnElectron()
