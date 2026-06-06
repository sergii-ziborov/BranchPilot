import { describe, expect, it } from 'vitest'
import { getProviderCommitUrl, getProviderRemoteSummary } from '../src/shared/providerRemote'

describe('provider remote detection', () => {
  it('detects GitHub HTTPS and SSH remotes', () => {
    expect(getProviderRemoteSummary('https://github.com/example/project.git')).toMatchObject({
      kind: 'github',
      label: 'GitHub',
      workflowLabel: 'pull request',
      host: 'github.com',
      owner: 'example',
      repository: 'project',
      supported: true
    })

    expect(getProviderRemoteSummary('git@github.com:example/project.git')).toMatchObject({
      kind: 'github',
      owner: 'example',
      repository: 'project',
      supported: true
    })

    expect(getProviderRemoteSummary('ssh://git@github.com/example/project.git')).toMatchObject({
      kind: 'github',
      owner: 'example',
      repository: 'project',
      supported: true
    })
  })

  it('detects planned GitLab and Bitbucket remotes', () => {
    expect(getProviderRemoteSummary('https://gitlab.com/group/subgroup/project.git')).toMatchObject({
      kind: 'gitlab',
      workflowLabel: 'merge request',
      owner: 'group/subgroup',
      repository: 'project',
      supported: false
    })

    expect(getProviderRemoteSummary('git@bitbucket.org:workspace/project.git')).toMatchObject({
      kind: 'bitbucket',
      workflowLabel: 'pull request',
      owner: 'workspace',
      repository: 'project',
      supported: false
    })
  })

  it('does not accept provider names outside the URL host', () => {
    expect(getProviderRemoteSummary('https://github.com.evil.test/example/project.git')).toMatchObject({
      kind: 'unknown',
      host: 'github.com.evil.test',
      supported: false
    })

    expect(getProviderRemoteSummary('https://gitlab.com/github.com/example/project.git')).toMatchObject({
      kind: 'gitlab',
      owner: 'github.com/example',
      repository: 'project',
      supported: false
    })
  })

  it('reports missing or unparsable remotes clearly', () => {
    expect(getProviderRemoteSummary(undefined)).toMatchObject({
      kind: 'none',
      label: 'No remote',
      supported: false
    })

    expect(getProviderRemoteSummary('not a remote')).toMatchObject({
      kind: 'none',
      supported: false
    })
  })

  it('builds provider commit URLs for known remotes only', () => {
    const sha = '1234567890abcdef'

    expect(getProviderCommitUrl('https://github.com/example/project.git', sha))
      .toBe('https://github.com/example/project/commit/1234567890abcdef')
    expect(getProviderCommitUrl('https://gitlab.com/group/subgroup/project.git', sha))
      .toBe('https://gitlab.com/group/subgroup/project/-/commit/1234567890abcdef')
    expect(getProviderCommitUrl('git@bitbucket.org:workspace/project.git', sha))
      .toBe('https://bitbucket.org/workspace/project/commits/1234567890abcdef')

    expect(getProviderCommitUrl('https://example.com/group/project.git', sha)).toBeNull()
    expect(getProviderCommitUrl('https://github.com/example/project.git', 'not-a-sha')).toBeNull()
  })
})
