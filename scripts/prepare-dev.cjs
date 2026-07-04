const { execFileSync } = require('node:child_process')
const path = require('node:path')

const rootPath = path.resolve(__dirname, '..')
const rootNeedle = rootPath.toLowerCase()
const devServerPort = '5174'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.silent ? 'ignore' : 'inherit'],
    ...options
  })
}

function tryRun(command, args, options = {}) {
  try {
    return run(command, args, options)
  } catch {
    return ''
  }
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

function readDarwinProcesses() {
  const output = run('/bin/ps', ['-axo', 'pid=,ppid=,command='], { silent: true }).trim()
  if (!output) return []

  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return null
      const commandLine = match[3]
      const command = commandLine.trim().split(/\s+/)[0] ?? ''
      return {
        ProcessId: Number(match[1]),
        ParentProcessId: Number(match[2]),
        Name: path.basename(command),
        CommandLine: commandLine
      }
    })
    .filter(Boolean)
}

function readDarwinListeningProcessIds(port) {
  const output = tryRun('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { silent: true })
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^p(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number)
  )
}

function readDarwinProcessCwd(pid) {
  const output = tryRun('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { silent: true })
  const cwdLine = output.split(/\r?\n/).find((line) => line.startsWith('n'))
  return cwdLine ? cwdLine.slice(1) : ''
}

function protectedProcessIds(processes) {
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

function descendantProcessIds(processes, rootIds) {
  const childrenByParentId = new Map()
  for (const entry of processes) {
    const parentPid = Number(entry.ParentProcessId)
    const children = childrenByParentId.get(parentPid) ?? []
    children.push(Number(entry.ProcessId))
    childrenByParentId.set(parentPid, children)
  }

  const ids = new Set(rootIds)
  const stack = [...rootIds]
  while (stack.length > 0) {
    const pid = stack.pop()
    for (const childPid of childrenByParentId.get(pid) ?? []) {
      if (ids.has(childPid)) continue
      ids.add(childPid)
      stack.push(childPid)
    }
  }

  return ids
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
    lowerCommand.includes('wait-on') && lowerCommand.includes(`tcp:${devServerPort}`) ||
    lowerCommand.includes('run-electron.cjs') ||
    name === 'electron.exe'
  )
}

function isRootPath(filePath) {
  if (!filePath) return false
  const resolved = path.resolve(filePath)
  return resolved === rootPath
}

function stopWindowsDevProcesses() {
  const processes = readWindowsProcesses()
  const protectedIds = protectedProcessIds(processes)
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

function stopDarwinDevProcesses() {
  const processes = readDarwinProcesses()
  const protectedIds = protectedProcessIds(processes)
  const staleRootIds = new Set()
  const portListenerIds = readDarwinListeningProcessIds(devServerPort)

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    if (protectedIds.has(pid)) continue

    if (isBranchPilotDevProcess(entry)) {
      staleRootIds.add(pid)
      continue
    }

    if (portListenerIds.has(pid) && isRootPath(readDarwinProcessCwd(pid))) {
      staleRootIds.add(pid)
    }
  }

  const targets = [...descendantProcessIds(processes, staleRootIds)]
    .filter((pid) => !protectedIds.has(pid))
    .sort((a, b) => b - a)

  for (const pid of targets) {
    try {
      process.kill(pid, 'SIGKILL')
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
} else if (process.platform === 'darwin') {
  stopDarwinDevProcesses()
}
