import { describe, expect, it } from 'vitest'
import { isRepositorySyncOperation, repositorySyncOperationLabel } from '../src/lib/repositoryOperationLabels'

describe('repository operation labels', () => {
  it('treats commit and push as a repository sync operation', () => {
    expect(isRepositorySyncOperation('Committing and pushing...')).toBe(true)
    expect(repositorySyncOperationLabel('Committing and pushing...')).toBe('Committing and pushing')
  })
})
