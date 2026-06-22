const { spawn } = require('node:child_process')
const electronPath = require('electron')

for (const key of Object.keys(process.env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') {
    delete process.env[key]
  }
}

const child = spawn(electronPath, process.argv.slice(2), {
  env: process.env,
  stdio: 'inherit',
  windowsHide: false
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
