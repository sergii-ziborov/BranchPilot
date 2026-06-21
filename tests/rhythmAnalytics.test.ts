import { describe, expect, it } from 'vitest'
import { computeRhythm, rhythmLogArgs, RHYTHM_MARK } from '../electron/lib/rhythmAnalytics'

/** Build one commit block as `git log --pretty=format:\x01%ad --numstat` would emit. */
function commit(date: string, files: Array<[number | '-', number | '-', string]>): string {
  const head = `${RHYTHM_MARK}${date}`
  const stats = files.map(([a, r, f]) => `${a}\t${r}\t${f}`)
  return [head, ...stats].join('\n')
}

describe('computeRhythm', () => {
  const now = new Date('2026-06-21T12:00:00Z') // a Sunday

  it('returns a zeroed result for empty history', () => {
    const r = computeRhythm([''], now)
    expect(r.currentStreakDays).toBe(0)
    expect(r.longestStreakDays).toBe(0)
    expect(r.activeDaysLast30).toBe(0)
    expect(r.commitsThisWeek).toBe(0)
    expect(r.hotFiles).toEqual([])
    expect(r.weeklyCommits).toHaveLength(8)
    expect(r.windowDays).toBe(120)
  })

  it('counts the current streak back from today and finds the longest run', () => {
    const log = [
      commit('2026-06-21', [[5, 1, 'a.ts']]), // today (Sun)
      commit('2026-06-20', [[2, 0, 'a.ts']]),
      commit('2026-06-19', [[1, 1, 'b.ts']]),
      // gap on 06-18
      commit('2026-06-16', [[1, 0, 'c.ts']]),
      commit('2026-06-15', [[1, 0, 'c.ts']]),
    ].join('\n')
    const r = computeRhythm([log], now)
    expect(r.currentStreakDays).toBe(3) // 21,20,19
    expect(r.longestStreakDays).toBe(3)
    expect(r.activeDaysLast30).toBe(5)
  })

  it('keeps a streak alive when today is idle but yesterday committed', () => {
    const log = [
      commit('2026-06-20', [[1, 0, 'a.ts']]),
      commit('2026-06-19', [[1, 0, 'a.ts']]),
    ].join('\n')
    const r = computeRhythm([log], now)
    expect(r.currentStreakDays).toBe(2)
  })

  it('aggregates 30-day churn and ranks hot files by commit count', () => {
    const log = [
      commit('2026-06-21', [[10, 2, 'src/App.tsx'], [3, 0, 'src/util.ts']]),
      commit('2026-06-20', [[4, 4, 'src/App.tsx']]),
      commit('2026-06-19', [['-', '-', 'logo.png']]), // binary => 0/0
    ].join('\n')
    const r = computeRhythm([log], now)
    expect(r.linesAdded30).toBe(17)
    expect(r.linesRemoved30).toBe(6)
    expect(r.hotFiles[0].path).toBe('src/App.tsx')
    expect(r.hotFiles[0].commits).toBe(2)
    expect(r.hotFiles[0].added).toBe(14)
  })

  it('excludes churn older than 30 days but still counts the commit for cadence', () => {
    const log = [
      commit('2026-04-01', [[100, 100, 'old.ts']]), // >30 days before now
    ].join('\n')
    const r = computeRhythm([log], now)
    expect(r.linesAdded30).toBe(0)
    expect(r.linesRemoved30).toBe(0)
    expect(r.hotFiles).toEqual([])
    expect(r.longestStreakDays).toBe(1) // commit still seen for streak math
  })

  it('reports weekly velocity for this week vs last week', () => {
    const log = [
      commit('2026-06-21', [[1, 0, 'a.ts']]), // this week (week of 06-21)
      commit('2026-06-18', [[1, 0, 'a.ts']]), // last week (week of 06-14)
      commit('2026-06-16', [[1, 0, 'a.ts']]), // last week
    ].join('\n')
    const r = computeRhythm([log], now)
    expect(r.commitsThisWeek).toBe(1)
    expect(r.commitsLastWeek).toBe(2)
    expect(r.weeklyCommits.at(-1)).toEqual({ weekStart: '2026-06-21', commits: 1 })
  })

  it('merges commits from multiple repositories', () => {
    const repoA = commit('2026-06-21', [[1, 0, 'a.ts']])
    const repoB = commit('2026-06-21', [[2, 0, 'b.ts']])
    const r = computeRhythm([repoA, repoB], now)
    expect(r.commitsThisWeek).toBe(2)
    expect(r.linesAdded30).toBe(3)
  })

  it('builds log args with the requested window', () => {
    expect(rhythmLogArgs(90)).toContain('--since=90 days ago')
    expect(rhythmLogArgs(90)).toContain('--numstat')
  })
})
