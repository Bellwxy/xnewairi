import type { ExtractionCommit } from './memory-document'

import { describe, expect, it } from 'vitest'

import {
  acknowledgeAffectionEvents,
  backfillSession,
  clearMemory,
  commitExtraction,
  createMemoryDocument,
  deleteEpisode,
  editCoreBlock,
  setCoreBlockLock,
  validEpisodes,
} from './memory-document'

const at = new Date(2026, 9, 16, 9, 0).getTime()

/** Each batch reads its own messages, unless a test passes the same ids again. */
function commitOf(overrides: Partial<ExtractionCommit> = {}): ExtractionCommit {
  const batchId = overrides.batchId ?? 'batch-1'
  return {
    batchId,
    generation: 0,
    sessionId: 'session-a',
    messageIds: [`${batchId}-m1`, `${batchId}-m2`],
    readAt: at,
    coreBlocks: {},
    episodes: [],
    candidateIds: [],
    affectionDelta: 0,
    ...overrides,
  }
}

function episode(id: string, text: string, extra: Partial<ExtractionCommit['episodes'][number]> = {}) {
  return { id, text, importance: 0.5, keywords: [], replaces: [], ...extra }
}

describe('commitExtraction', () => {
  it('commits core blocks, episodes, and extracted message ids together', () => {
    const document = createMemoryDocument('mio', at)

    const { document: next, outcome } = commitExtraction(document, commitOf({
      coreBlocks: { 'user-profile': 'The user is called Ren.' },
      episodes: [episode('e1', 'The user was born on 3 May.', { factKey: 'user.birthday', annualDate: { month: 5, day: 3 } })],
    }), at)

    expect(outcome).toBe('committed')
    expect(next.revision).toBe(1)
    expect(next.coreBlocks['user-profile'].text).toBe('The user is called Ren.')
    expect(next.episodes[0]).toMatchObject({ id: 'e1', sourceSessionId: 'session-a', sourceMessageIds: ['batch-1-m1', 'batch-1-m2'], extractionBatchId: 'batch-1' })
    expect(next.extractedMessageIds).toEqual(['batch-1-m1', 'batch-1-m2'])
  })

  it('commits one batch at most once', () => {
    const first = commitExtraction(createMemoryDocument('mio', at), commitOf({ episodes: [episode('e1', 'A.')] }), at).document

    const second = commitExtraction(first, commitOf({ episodes: [episode('e2', 'B.')] }), at)

    expect(second.outcome).toBe('duplicate')
    expect(second.document.episodes).toHaveLength(1)
  })

  // Review finding: with a cut id list, the first batch came back after 10,020 rounds.
  it('still rejects the first batch after 10,020 more rounds', () => {
    let document = commitExtraction(createMemoryDocument('mio', at), commitOf({ batchId: 'first', messageIds: ['first-u', 'first-a'] }), at).document
    const rounds = Array.from({ length: 10_020 }, (_, index) => [`u${index}`, `a${index}`]).flat()
    // One commit holds all later rounds, so the test stays fast. Extraction would split them into batches.
    document = commitExtraction(document, commitOf({ batchId: 'later', messageIds: rounds }), at).document

    const replay = commitExtraction(document, commitOf({ batchId: 'first-retry', messageIds: ['first-u', 'first-a'] }), at)

    expect(replay.outcome).toBe('duplicate')
    expect(document.extractedMessageIds).toHaveLength(20_042)
  })

  it('keeps an affection event in the same commit as the memory', () => {
    const next = commitExtraction(createMemoryDocument('mio', at), commitOf({ affectionDelta: 4 }), at).document

    expect(next.pendingAffectionEvents).toEqual([{ batchId: 'batch-1', delta: 4 }])
    expect(acknowledgeAffectionEvents(next, ['batch-1']).pendingAffectionEvents).toEqual([])
  })

  it('keeps pending affection when the user clears memory', () => {
    const next = commitExtraction(createMemoryDocument('mio', at), commitOf({ affectionDelta: 4 }), at).document

    expect(clearMemory(next, at).pendingAffectionEvents).toEqual([{ batchId: 'batch-1', delta: 4 }])
  })

  it('discards a batch from an older generation', () => {
    const cleared = clearMemory(createMemoryDocument('mio', at), at)

    const result = commitExtraction(cleared, commitOf({ generation: 0, episodes: [episode('e1', 'A.')] }), at)

    expect(result.outcome).toBe('stale-generation')
    expect(result.document.episodes).toEqual([])
  })

  it('does not rewrite a locked core block', () => {
    const locked = setCoreBlockLock(editCoreBlock(createMemoryDocument('mio', at), 'user-profile', 'Edited by the user.', at), 'user-profile', true)

    const next = commitExtraction(locked, commitOf({ coreBlocks: { 'user-profile': 'From the model.' } }), at).document

    expect(next.coreBlocks['user-profile'].text).toBe('Edited by the user.')
  })

  it('keeps a core block that the user edited while extraction ran', () => {
    const edited = editCoreBlock(createMemoryDocument('mio', at), 'relationship', 'Edited by the user.', at + 5000)

    const next = commitExtraction(edited, commitOf({ readAt: at, coreBlocks: { relationship: 'From the model.' } }), at + 9000).document

    expect(next.coreBlocks.relationship.text).toBe('Edited by the user.')
  })

  it('replaces an older residence even when it is far back in the history', () => {
    let document = commitExtraction(createMemoryDocument('mio', at), commitOf({
      episodes: [episode('old', 'The user lives in Beijing.', { factKey: 'user.residence' })],
    }), at).document
    for (let index = 0; index < 100; index++)
      document = commitExtraction(document, commitOf({ batchId: `filler-${index}`, episodes: [episode(`f${index}`, `Fact ${index}.`)] }), at).document

    document = commitExtraction(document, commitOf({
      batchId: 'move',
      episodes: [episode('new', 'The user moved to Shanghai.', { factKey: 'user.residence' })],
    }), at).document

    const old = document.episodes.find(item => item.id === 'old')
    expect(old?.invalidatedAt).toBe(at)
    expect(old?.supersededBy).toBe('new')
    expect(validEpisodes(document).some(item => item.id === 'old')).toBe(false)
  })

  it('keeps several values of a multi-valued fact kind', () => {
    let document = commitExtraction(createMemoryDocument('mio', at), commitOf({
      episodes: [episode('tea', 'The user likes tea.', { factKey: 'user.likes' })],
    }), at).document

    document = commitExtraction(document, commitOf({
      batchId: 'batch-2',
      episodes: [episode('cats', 'The user likes cats.', { factKey: 'user.likes' })],
    }), at).document

    expect(validEpisodes(document).map(item => item.id)).toEqual(['tea', 'cats'])
  })

  it('accepts a replacement only for an id that the extractor received', () => {
    const document = commitExtraction(createMemoryDocument('mio', at), commitOf({
      episodes: [episode('a', 'The user plays guitar.'), episode('b', 'The user plays piano.')],
    }), at).document

    const next = commitExtraction(document, commitOf({
      batchId: 'batch-2',
      candidateIds: ['a'],
      episodes: [episode('c', 'The user stopped playing guitar.', { replaces: ['a', 'b'] })],
    }), at).document

    expect(next.episodes.find(item => item.id === 'a')?.invalidatedAt).toBe(at)
    expect(next.episodes.find(item => item.id === 'b')?.invalidatedAt).toBeUndefined()
  })
})

describe('memory edits', () => {
  it('does not let a replayed batch restore a deleted episode', () => {
    const committed = commitExtraction(createMemoryDocument('mio', at), commitOf({ episodes: [episode('e1', 'A.')] }), at).document
    const deleted = deleteEpisode(committed, 'e1')
    // A retry of another batch carries the same episode id.
    const replayed = commitExtraction(deleted, commitOf({ batchId: 'batch-retry', episodes: [episode('e1', 'A.')] }), at).document

    expect(replayed.episodes).toEqual([])
  })

  it('clears memory, starts a new generation, and blocks automatic extraction of old messages', () => {
    const committed = commitExtraction(createMemoryDocument('mio', at), commitOf({
      coreBlocks: { relationship: 'Close friends.' },
      episodes: [episode('e1', 'A.')],
    }), at).document

    const cleared = clearMemory(committed, at + 1000)

    expect(cleared.generation).toBe(1)
    expect(cleared.episodes).toEqual([])
    expect(cleared.coreBlocks.relationship.text).toBe('')
    expect(cleared.autoExtractFrom).toBe(at + 1000)
  })

  it('starts automatic extraction 7 days before first use', () => {
    expect(createMemoryDocument('mio', at).autoExtractFrom).toBe(at - 7 * 24 * 60 * 60 * 1000)
  })

  it('records a backfilled session once', () => {
    const document = backfillSession(backfillSession(createMemoryDocument('mio', at), 'session-a'), 'session-a')

    expect(document.backfilledSessionIds).toEqual(['session-a'])
  })

  it('limits a core block to 750 code points', () => {
    const document = editCoreBlock(createMemoryDocument('mio', at), 'user-profile', '😀'.repeat(800), at)

    expect([...document.coreBlocks['user-profile'].text]).toHaveLength(750)
  })
})
