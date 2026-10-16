import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryDocument, editCoreBlock } from '../../stores/memory/memory-document'
import { characterMemoryRepo } from './character-memory.repo'

afterEach(async () => {
  await characterMemoryRepo.clearAll()
})

describe('character memory repository', () => {
  it('keeps every change of concurrent writers', async () => {
    // Each writer reads, then writes after an await. Without the lock, a later write would drop an earlier one.
    await Promise.all(Array.from({ length: 10 }, (_, index) => characterMemoryRepo.update('mio', current => ({
      ...current,
      revision: current.revision + 1,
      deletedEpisodeIds: [...current.deletedEpisodeIds, `e${index}`],
    }))))

    const stored = await characterMemoryRepo.get('mio')
    expect(stored?.revision).toBe(10)
    expect(stored?.deletedEpisodeIds).toHaveLength(10)
  })

  it('fixes the automatic start time at first use', async () => {
    const first = await characterMemoryRepo.getOrCreate('mio')
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await characterMemoryRepo.getOrCreate('mio')

    expect(second.autoExtractFrom).toBe(first.autoExtractFrom)
  })

  it('writes a whole record in one step', async () => {
    const at = Date.now()
    await characterMemoryRepo.update('mio', () => editCoreBlock(createMemoryDocument('mio', at), 'relationship', 'Close friends.', at))

    const stored = await characterMemoryRepo.get('mio')
    expect(stored?.coreBlocks.relationship.text).toBe('Close friends.')
    expect(stored?.coreBlocks['user-profile'].text).toBe('')
  })

  it('keeps vectors of one model apart from another', async () => {
    await characterMemoryRepo.getOrCreate('mio')
    await characterMemoryRepo.putVectors('mio', 'model-a', { e1: [1, 0] })
    await characterMemoryRepo.putVectors('mio', 'model-a', { e2: [0, 1] })
    expect(Object.keys((await characterMemoryRepo.getVectors('mio'))!.vectors)).toEqual(['e1', 'e2'])

    await characterMemoryRepo.putVectors('mio', 'model-b', { e3: [1, 1] })
    expect(await characterMemoryRepo.getVectors('mio')).toEqual({ model: 'model-b', vectors: { e3: [1, 1] } })
  })

  it('writes no vectors for a character without memory', async () => {
    await characterMemoryRepo.putVectors('ghost', 'model-a', { e1: [1] })

    expect(await characterMemoryRepo.getVectors('ghost')).toBeNull()
  })

  it('does not recreate a record that a deletion removed', async () => {
    await characterMemoryRepo.getOrCreate('mio')
    await characterMemoryRepo.clearAll()

    expect(await characterMemoryRepo.updateExisting('mio', current => ({ ...current, revision: current.revision + 1 }))).toBeNull()
    expect(await characterMemoryRepo.get('mio')).toBeNull()
  })

  it('lets clearing all memory wait for a running write', async () => {
    await characterMemoryRepo.getOrCreate('mio')
    const slowWrite = characterMemoryRepo.updateExisting('mio', (current) => {
      // The commit is still inside its locks when the deletion starts.
      return { ...current, revision: current.revision + 1 }
    })
    const clearing = characterMemoryRepo.clearAll()
    await Promise.all([slowWrite, clearing])

    expect(await characterMemoryRepo.get('mio')).toBeNull()
  })

  it('removes the memory of a deleted character', async () => {
    await characterMemoryRepo.getOrCreate('mio')
    await characterMemoryRepo.putVectors('mio', 'model-a', { e1: [1] })

    await characterMemoryRepo.remove('mio')

    expect(await characterMemoryRepo.get('mio')).toBeNull()
    expect(await characterMemoryRepo.getVectors('mio')).toBeNull()
  })
})
