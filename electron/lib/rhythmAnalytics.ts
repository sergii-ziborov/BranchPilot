import type { RepositoryRhythm, RhythmHotFile, RhythmWeek } from '../../src/shared/branchPilot.js'

/**
 * Record marker prefixed to each commit's `git log` line so the numstat block
 * that follows can be attributed to the right commit date.
 */
export const RHYTHM_MARK = '\x01'

/** Git args that produce the log this module parses (one entry per commit + numstat). */
export function rhythmLogArgs(windowDays: number): string[] {
  return ['log', `--since=${windowDays} days ago`, `--pretty=format:${RHYTHM_MARK}%ad`, '--date=short', '--numstat']
}

/**
 * Pure cadence / velocity / churn computation over one or more `git log --numstat`
 * outputs. Kept side-effect free (time is injected) so it is unit-testable without
 * a real repository.
 */
export function computeRhythm(logs: string[], now: Date = new Date(), windowDays = 120): RepositoryRhythm {
  const dayMs = 86_400_000
  const dayNumber = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Math.floor(Date.UTC(y, m - 1, d) / dayMs)
  }
  const isoOf = (num: number) => new Date(num * dayMs).toISOString().slice(0, 10)
  const weekStartOf = (iso: string) => {
    const dt = new Date(`${iso}T00:00:00Z`)
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay())
    return dt.toISOString().slice(0, 10)
  }

  const todayNum = Math.floor(now.getTime() / dayMs)
  const todayISO = isoOf(todayNum)

  const activeDayNums = new Set<number>()
  const commitDates: string[] = []
  const weekCounts = new Map<string, number>()
  const fileStats = new Map<string, RhythmHotFile>()
  let linesAdded30 = 0
  let linesRemoved30 = 0

  for (const stdout of logs) {
    let currentDate = ''
    let currentNum = 0
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line.startsWith(RHYTHM_MARK)) {
        currentDate = line.slice(1).trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) { currentDate = ''; continue }
        currentNum = dayNumber(currentDate)
        activeDayNums.add(currentNum)
        commitDates.push(currentDate)
        const ws = weekStartOf(currentDate)
        weekCounts.set(ws, (weekCounts.get(ws) ?? 0) + 1)
        continue
      }
      if (!currentDate) continue
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const within30 = todayNum - currentNum <= 29
      if (!within30) continue
      const added = parts[0] === '-' ? 0 : Number(parts[0])
      const removed = parts[1] === '-' ? 0 : Number(parts[1])
      const file = parts.slice(2).join('\t').trim()
      if (!file) continue
      linesAdded30 += Number.isFinite(added) ? added : 0
      linesRemoved30 += Number.isFinite(removed) ? removed : 0
      const existing = fileStats.get(file)
      if (existing) {
        existing.commits += 1
        existing.added += Number.isFinite(added) ? added : 0
        existing.removed += Number.isFinite(removed) ? removed : 0
      } else {
        fileStats.set(file, { path: file, commits: 1, added: Number.isFinite(added) ? added : 0, removed: Number.isFinite(removed) ? removed : 0 })
      }
    }
  }

  // Cadence: current streak (counts back from today, or yesterday if today is idle).
  let currentStreakDays = 0
  let probe = activeDayNums.has(todayNum) ? todayNum : todayNum - 1
  while (activeDayNums.has(probe)) {
    currentStreakDays += 1
    probe -= 1
  }

  // Longest streak inside the window.
  const sortedDays = [...activeDayNums].sort((a, b) => a - b)
  let longestStreakDays = sortedDays.length > 0 ? 1 : 0
  let run = sortedDays.length > 0 ? 1 : 0
  for (let i = 1; i < sortedDays.length; i += 1) {
    run = sortedDays[i] - sortedDays[i - 1] === 1 ? run + 1 : 1
    if (run > longestStreakDays) longestStreakDays = run
  }

  const activeDaysLast30 = [...activeDayNums].filter((num) => todayNum - num <= 29 && todayNum - num >= 0).length
  const commits30 = commitDates.filter((iso) => todayNum - dayNumber(iso) <= 29).length
  const avgCommitsPerActiveDay = activeDaysLast30 > 0 ? commits30 / activeDaysLast30 : 0

  // Velocity: this week vs last week + last 8 weeks for a sparkline.
  const currentWeekStart = weekStartOf(todayISO)
  const lastWeekStart = isoOf(dayNumber(currentWeekStart) - 7)
  const commitsThisWeek = weekCounts.get(currentWeekStart) ?? 0
  const commitsLastWeek = weekCounts.get(lastWeekStart) ?? 0

  const weeklyCommits: RhythmWeek[] = []
  for (let i = 7; i >= 0; i -= 1) {
    const ws = isoOf(dayNumber(currentWeekStart) - i * 7)
    weeklyCommits.push({ weekStart: ws, commits: weekCounts.get(ws) ?? 0 })
  }

  const hotFiles = [...fileStats.values()]
    .sort((a, b) => b.commits - a.commits || b.added + b.removed - (a.added + a.removed))
    .slice(0, 5)

  return {
    generatedAt: now.toISOString(),
    windowDays,
    currentStreakDays,
    longestStreakDays,
    activeDaysLast30,
    commitsThisWeek,
    commitsLastWeek,
    avgCommitsPerActiveDay,
    weeklyCommits,
    linesAdded30,
    linesRemoved30,
    hotFiles
  }
}
