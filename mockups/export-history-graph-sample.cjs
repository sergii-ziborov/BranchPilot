const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const separator = '\x1f'
const ansiPattern = /\x1b\[[0-9;]*m/g
const ansiColorMap = new Map([
  ['31', '#ff7b72'],
  ['32', '#3fb950'],
  ['33', '#d29922'],
  ['34', '#58a6ff'],
  ['35', '#bc8cff'],
  ['36', '#39c5cf'],
  ['1;31', '#ff938a'],
  ['1;32', '#56d364'],
  ['1;33', '#eac54f'],
  ['1;34', '#79c0ff'],
  ['1;35', '#d2a8ff'],
  ['1;36', '#56d4dd']
])
const repoPath = process.argv[2] || process.cwd()
const output = execFileSync(
  'git',
  [
    '-c',
    'color.ui=always',
    'log',
    '--graph',
    '--color=always',
    '--topo-order',
    '--all',
    '--max-count=180',
    '--date=iso-strict',
    '--pretty=format:%x1f%H%x00%h%x00%s%x00%P%x00%an%x00%ae%x00%ad'
  ],
  { cwd: repoPath, encoding: 'utf8', maxBuffer: 1024 * 1024 * 12 }
)

const commits = []

function stripAnsi(value) {
  return String(value).replace(ansiPattern, '')
}

function parseGraphTokens(value) {
  const tokens = []
  let color = null
  let column = 0
  let index = 0

  while (index < value.length) {
    if (value[index] === '\x1b') {
      const match = /^\x1b\[([0-9;]*)m/u.exec(value.slice(index))
      if (match) {
        color = ansiColorMap.get(match[1] || '0') || null
        index += match[0].length
        continue
      }
    }

    const ch = value[index]
    if (ch !== ' ') tokens.push({ column, ch, color })
    column += 1
    index += 1
  }

  return tokens
}

for (const rawLine of output.split(/\r?\n/)) {
  const line = rawLine.replace(/\s+$/u, '')
  if (!line) continue

  const payloadIndex = line.indexOf(separator)
  if (payloadIndex === -1) {
    const previous = commits[commits.length - 1]
    if (previous) {
      previous.graphAfter.push(stripAnsi(line))
      previous.graphAfterTokens.push(parseGraphTokens(line))
    }
    continue
  }

  const graphPrefixRaw = line.slice(0, payloadIndex)
  const graphPrefix = stripAnsi(graphPrefixRaw)
  const [sha, shortSha, subject, parents, authorName, authorEmail, date] = stripAnsi(line.slice(payloadIndex + 1)).split('\x00')
  commits.push({
    sha,
    shortSha,
    subject,
    parentShas: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    date,
    graphPrefix,
    graphPrefixTokens: parseGraphTokens(graphPrefixRaw),
    graphAfter: [],
    graphAfterTokens: []
  })
}

writeFileSync(
  join(__dirname, 'history-graph-sample.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), repoPath, commits }, null, 2)}\n`
)

console.log(`Wrote ${commits.length} commits from ${repoPath} to mockups/history-graph-sample.json`)
