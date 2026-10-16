/**
 * The long-term memory of one character in one account, stored as one record.
 *
 * One record makes each commit atomic: a write replaces the whole record, so an extraction never
 * commits half of its core blocks, episodes, and extracted message ids. Writers hold a Web Lock
 * per character, read the record, apply one of the pure operations below, and write it back.
 * Embedding vectors live in another store, because they are written after the commit.
 */
export interface CharacterMemoryDocument {
  characterId: string
  /** Increments on every write. A request prompt built from an older revision is stale. */
  revision: number
  /** Increments when the user clears the memory. Work that started in an older generation is discarded. */
  generation: number
  coreBlocks: Record<CoreMemoryBlockKey, CoreMemoryBlock>
  episodes: EpisodeMemory[]
  /**
   * Messages older than this timestamp are never extracted automatically.
   * First use sets it to 7 days ago. Clearing sets it to the clear time.
   */
  autoExtractFrom: number
  /** Sessions that the user backfilled by hand. Extraction reads all of their history. */
  backfilledSessionIds: string[]
  /**
   * Every message that an extraction of this character read. A retried batch and a forked copy of a message are not read again.
   * The list is never cut: a cut list would let old messages come back. About 7300 ids a year cost about 160 KB.
   */
  extractedMessageIds: string[]
  /** Episodes that the user deleted. A replayed batch cannot restore them. */
  deletedEpisodeIds: string[]
  /**
   * Affection deltas that a commit produced and the character state has not applied yet.
   * They are committed together with the memory, so a crash between the two writes loses nothing.
   * The store applies them by batch id, which the character state dedupes, and then removes them.
   */
  pendingAffectionEvents: Array<{ batchId: string, delta: number }>
}

export type CoreMemoryBlockKey = 'user-profile' | 'relationship'

export const coreMemoryBlockKeys: readonly CoreMemoryBlockKey[] = ['user-profile', 'relationship']

export interface CoreMemoryBlock {
  key: CoreMemoryBlockKey
  text: string
  /** When true, extraction does not rewrite this block. */
  lockedByUser: boolean
  updatedAt: number
}

export interface EpisodeMemory {
  id: string
  /** One self-contained sentence, with absolute dates. */
  text: string
  /** 0 to 1. The extractor assigns it. */
  importance: number
  keywords: string[]
  occurredAt?: number
  /** A yearly date without a year, for example a birthday. Proactive care reads it. */
  annualDate?: { month: number, day: number }
  /** A stable subject and predicate, for example `user.residence`. It names the kind of fact, not its value. */
  factKey?: string
  createdAt: number
  /** Set when a newer episode replaces this one. The record stays visible in the advanced view. */
  invalidatedAt?: number
  supersededBy?: string
  sourceSessionId?: string
  sourceMessageIds: string[]
  extractionBatchId: string
}

/** The extraction output after validation, with episode ids that the app assigned. */
export interface ExtractionCommit {
  batchId: string
  generation: number
  sessionId: string
  messageIds: string[]
  /** When extraction read the record. A core block that the user edited after this time keeps the edit. */
  readAt: number
  /** Omitted blocks stay unchanged. Locked blocks are skipped. */
  coreBlocks: Partial<Record<CoreMemoryBlockKey, string>>
  episodes: Array<Omit<EpisodeMemory, 'createdAt' | 'sourceSessionId' | 'sourceMessageIds' | 'extractionBatchId'> & {
    /** Ids of existing episodes that this episode replaces. Only ids in `candidateIds` count. */
    replaces: string[]
  }>
  /** The ids that the extractor received as candidates. The extractor cannot replace any other episode. */
  candidateIds: string[]
  /** -10 to 10. A non-zero delta becomes a pending affection event of this batch. */
  affectionDelta: number
}

export type CommitOutcome = 'committed' | 'duplicate' | 'stale-generation'

/** Core block limit in Unicode code points. Spec 2.1 sets 750. */
export const coreBlockLimit = 750

/**
 * Fact kinds with one current value. A new episode of such a kind replaces the older valid one.
 * Other kinds, for example preferences, keep several values, and only explicit `replaces` ids replace them.
 */
const singleValuedFactKeys = new Set([
  'user.name',
  'user.nickname',
  'user.birthday',
  'user.age',
  'user.residence',
  'user.job',
  'user.school',
  'relationship.anniversary',
])

const dayMs = 24 * 60 * 60 * 1000

function emptyBlock(key: CoreMemoryBlockKey, at: number): CoreMemoryBlock {
  return { key, text: '', lockedByUser: false, updatedAt: at }
}

/** A character without memory starts here. The first 7 days before `at` can still be extracted. */
export function createMemoryDocument(characterId: string, at: number): CharacterMemoryDocument {
  return {
    characterId,
    revision: 0,
    generation: 0,
    coreBlocks: { 'user-profile': emptyBlock('user-profile', at), 'relationship': emptyBlock('relationship', at) },
    episodes: [],
    autoExtractFrom: at - 7 * dayMs,
    backfilledSessionIds: [],
    extractedMessageIds: [],
    deletedEpisodeIds: [],
    pendingAffectionEvents: [],
  }
}

function truncateCodePoints(text: string, limit: number) {
  return [...text].slice(0, limit).join('')
}

function next(document: CharacterMemoryDocument, changes: Partial<CharacterMemoryDocument>): CharacterMemoryDocument {
  return { ...document, ...changes, revision: document.revision + 1 }
}

/**
 * Applies one validated extraction. The operation is idempotent and discards work of an older generation.
 * A batch whose messages were all read already is a duplicate, for example a retry or a forked copy.
 *
 * Locked core blocks are skipped. Invalidation only accepts ids that the extractor received, that belong to this
 * document, and that are still valid. A new episode of a single-valued fact kind replaces the older valid one.
 */
export function commitExtraction(document: CharacterMemoryDocument, commit: ExtractionCommit, at: number): { document: CharacterMemoryDocument, outcome: CommitOutcome } {
  if (commit.generation !== document.generation)
    return { document, outcome: 'stale-generation' }
  const extracted = new Set(document.extractedMessageIds)
  if (commit.messageIds.every(id => extracted.has(id)))
    return { document, outcome: 'duplicate' }

  const coreBlocks = { ...document.coreBlocks }
  for (const key of coreMemoryBlockKeys) {
    const text = commit.coreBlocks[key]
    if (text === undefined || coreBlocks[key].lockedByUser || coreBlocks[key].updatedAt > commit.readAt)
      continue
    coreBlocks[key] = { ...coreBlocks[key], text: truncateCodePoints(text.trim(), coreBlockLimit), updatedAt: at }
  }

  const deleted = new Set(document.deletedEpisodeIds)
  const accepted = commit.episodes.filter(episode => !deleted.has(episode.id))
  const newEpisodes: EpisodeMemory[] = accepted
    .map(({ replaces: _replaces, ...episode }) => ({
      ...episode,
      createdAt: at,
      sourceSessionId: commit.sessionId,
      sourceMessageIds: commit.messageIds,
      extractionBatchId: commit.batchId,
    }))

  const candidates = new Set(commit.candidateIds)
  const replacedBy = new Map<string, string>()
  for (const episode of accepted) {
    for (const id of episode.replaces) {
      if (candidates.has(id))
        replacedBy.set(id, episode.id)
    }
  }
  for (const episode of newEpisodes) {
    if (!episode.factKey || !singleValuedFactKeys.has(episode.factKey))
      continue
    for (const existing of document.episodes) {
      if (existing.factKey === episode.factKey && !existing.invalidatedAt)
        replacedBy.set(existing.id, episode.id)
    }
  }

  const episodes = [
    ...document.episodes.map((episode) => {
      const supersededBy = replacedBy.get(episode.id)
      return supersededBy && !episode.invalidatedAt ? { ...episode, invalidatedAt: at, supersededBy } : episode
    }),
    ...newEpisodes,
  ]

  return {
    document: next(document, {
      coreBlocks,
      episodes,
      extractedMessageIds: [...document.extractedMessageIds, ...commit.messageIds.filter(id => !extracted.has(id))],
      pendingAffectionEvents: commit.affectionDelta
        ? [...document.pendingAffectionEvents, { batchId: commit.batchId, delta: commit.affectionDelta }]
        : document.pendingAffectionEvents,
    }),
    outcome: 'committed',
  }
}

/** Removes affection events that the character state applied. */
export function acknowledgeAffectionEvents(document: CharacterMemoryDocument, batchIds: readonly string[]): CharacterMemoryDocument {
  const remaining = document.pendingAffectionEvents.filter(event => !batchIds.includes(event.batchId))
  return remaining.length === document.pendingAffectionEvents.length ? document : next(document, { pendingAffectionEvents: remaining })
}

/** Deletes one episode and remembers its id, so a replayed batch cannot restore it. */
export function deleteEpisode(document: CharacterMemoryDocument, episodeId: string): CharacterMemoryDocument {
  return next(document, {
    episodes: document.episodes.filter(episode => episode.id !== episodeId),
    deletedEpisodeIds: [...document.deletedEpisodeIds, episodeId],
  })
}

/** Replaces the text of a core block. A user edit is kept even when the block is not locked. */
export function editCoreBlock(document: CharacterMemoryDocument, key: CoreMemoryBlockKey, text: string, at: number): CharacterMemoryDocument {
  return next(document, {
    coreBlocks: { ...document.coreBlocks, [key]: { ...document.coreBlocks[key], text: truncateCodePoints(text, coreBlockLimit), updatedAt: at } },
  })
}

export function setCoreBlockLock(document: CharacterMemoryDocument, key: CoreMemoryBlockKey, locked: boolean): CharacterMemoryDocument {
  return next(document, {
    coreBlocks: { ...document.coreBlocks, [key]: { ...document.coreBlocks[key], lockedByUser: locked } },
  })
}

/**
 * Clears all memory of the character and starts a new generation.
 * Messages before `at` are never extracted again automatically, so old chat does not come back as memory.
 * Chats and the personality stay unchanged.
 */
export function clearMemory(document: CharacterMemoryDocument, at: number): CharacterMemoryDocument {
  const cleared = createMemoryDocument(document.characterId, at)
  return {
    ...cleared,
    autoExtractFrom: at,
    generation: document.generation + 1,
    revision: document.revision + 1,
    // Clearing memory does not take back affection that the character already earned.
    pendingAffectionEvents: document.pendingAffectionEvents,
  }
}

/** Lets extraction read the whole history of one session. */
export function backfillSession(document: CharacterMemoryDocument, sessionId: string): CharacterMemoryDocument {
  if (document.backfilledSessionIds.includes(sessionId))
    return document
  return next(document, { backfilledSessionIds: [...document.backfilledSessionIds, sessionId] })
}

/** Episodes that recall can use. Invalidated episodes stay in the record but never reach a prompt. */
export function validEpisodes(document: CharacterMemoryDocument): EpisodeMemory[] {
  return document.episodes.filter(episode => !episode.invalidatedAt)
}
