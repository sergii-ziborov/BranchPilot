const { execFileSync } = require('node:child_process')
const path = require('node:path')

const rootPath = path.resolve(__dirname, '..')
const rootNeedle = rootPath.toLowerCase()

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.silent ? 'ignore' : 'inherit'],
    ...options
  })
}

function readWindowsProcesses() {
  const script = [
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine |',
    'ConvertTo-Json -Compress'
  ].join(' ')
  const output = run('powershell.exe', ['-NoProfile', '-Command', script], { silent: true }).trim()
  if (!output) return []
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function protectedWindowsProcessIds(processes) {
  const byPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const protectedIds = new Set([process.pid, process.ppid])
  let current = byPid.get(process.ppid)

  while (current) {
    const pid = Number(current.ProcessId)
    const parentPid = Number(current.ParentProcessId)
    protectedIds.add(pid)
    if (!parentPid || protectedIds.has(parentPid)) break
    current = byPid.get(parentPid)
  }

  return protectedIds
}

function isBranchPilotDevProcess(entry) {
  const commandLine = String(entry.CommandLine ?? '')
  const lowerCommand = commandLine.toLowerCase()
  const name = String(entry.Name ?? '').toLowerCase()

  if (!lowerCommand.includes(rootNeedle)) return false
  return (
    lowerCommand.includes('npm-cli.js') && lowerCommand.includes('run dev') ||
    lowerCommand.includes('concurrently') ||
    lowerCommand.includes('vite') && lowerCommand.includes('--port 5174') ||
    lowerCommand.includes('tsconfig.electron.json') && lowerCommand.includes('--watch') ||
    lowerCommand.includes('run-electron.cjs') ||
    name === 'electron.exe'
  )
}

function stopWindowsDevProcesses() {
  const processes = readWindowsProcesses()
  const protectedIds = protectedWindowsProcessIds(processes)
  const targets = processes
    .filter((entry) => isBranchPilotDevProcess(entry))
    .filter((entry) => !protectedIds.has(Number(entry.ProcessId)))

  for (const target of targets) {
    try {
      run('taskkill.exe', ['/PID', String(target.ProcessId), '/T', '/F'], { silent: true })
    } catch {
      /* Process may have already exited. */
    }
  }

  if (targets.length > 0) {
    console.log(`[prepare-dev] Stopped ${targets.length} stale BranchPilot dev process${targets.length === 1 ? '' : 'es'}.`)
  }
}

if (process.platform === 'win32') {
  stopWindowsDevProcesses()
}
