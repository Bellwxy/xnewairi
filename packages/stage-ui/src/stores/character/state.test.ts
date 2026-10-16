// @vitest-environment jsdom

import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useCharacterStateStore } from './state'

const start = new Date(2026, 9, 16, 9, 0).getTime()

describe('character state store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('keeps affection across a restart', async () => {
    const store = useCharacterStateStore()
    await store.recordRound('mio', start)
    await nextTick()

    setActivePinia(createPinia())
    const restarted = useCharacterStateStore()

    expect(restarted.affections.mio?.points).toBe(6)
    expect(JSON.parse(localStorage.getItem(accountStorageKey('character-state/affections')) ?? '{}')).toHaveProperty('mio')
  })

  it('keeps the state of each character apart', async () => {
    const store = useCharacterStateStore()
    await store.recordEmotion('mio', 'happy', 1, start)

    expect(store.moods.mio?.valence).toBeGreaterThan(0)
    expect(store.moods.ren).toBeUndefined()
  })

  it('changes the prompt text when the relationship stage changes', async () => {
    const store = useCharacterStateStore()
    const before = store.describe('mio', start)

    for (let delta = 0; delta < 20; delta++)
      await store.applyAffectionDelta('mio', `batch-${delta}`, 10, start)

    expect(store.describe('mio', start)).toContain('Relationship: friend.')
    expect(store.describe('mio', start)).not.toBe(before)
  })

  it('forgets a deleted character', async () => {
    const store = useCharacterStateStore()
    await store.recordEmotion('mio', 'sad', 1, start)
    await store.recordRound('mio', start)
    await store.recordRound('ren', start)

    await store.forgetCharacter('mio')

    expect(store.moods.mio).toBeUndefined()
    expect(store.affections.mio).toBeUndefined()
    expect(store.affections.ren?.points).toBe(6)
  })
})
