import { describe, expect, it } from 'vitest'
import { remoteMatchesRepository } from '../electron/providers/githubCliService.repositories'

describe('remoteMatchesRepository', () => {
  it('matches the repository across https and ssh remote URL forms', () => {
    for (const url of [
      'https://github.com/sergii-ziborov/weavatrix.git',
      'https://github.com/sergii-ziborov/weavatrix',
      'https://github.com/Sergii-Ziborov/Weavatrix.git',
      'git@github.com:sergii-ziborov/weavatrix.git',
      'git@github.com:sergii-ziborov/weavatrix'
    ]) {
      expect(remoteMatchesRepository(url, 'sergii-ziborov', 'weavatrix'), url).toBe(true)
    }
  })

  it('does not match a different owner or repository', () => {
    expect(remoteMatchesRepository('https://github.com/other-user/weavatrix.git', 'sergii-ziborov', 'weavatrix')).toBe(false)
    expect(remoteMatchesRepository('https://github.com/sergii-ziborov/other-repo.git', 'sergii-ziborov', 'weavatrix')).toBe(false)
    // A lookalike owner must not be treated as a prefix match.
    expect(remoteMatchesRepository('https://github.com/evil-sergii-ziborov/weavatrix.git', 'sergii-ziborov', 'weavatrix')).toBe(false)
  })
})
