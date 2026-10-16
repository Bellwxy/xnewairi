import type { CharacterMemoryDocument } from '../../stores/memory/memory-document'

import { createAccountLocalForage } from '@proj-airi/stage-shared/account-scope/localforage'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'

import { createMemoryDocument } from '../../stores/memory/memory-document'

/** The embedding vectors of one character. All vectors come from `model`. A model change replaces the whole record. */
export interface CharacterMemoryVectors {
  /** Provider, endpoint, model id, and dimensions. It holds no credentials. */
  model: string
  vectors: Record<string, number[]>
}

/** A change notice for other windows. Each window reloads the record when the revision is newer. */
export interface CharacterMemoryChange {
  characterId: string
  revision: number
}

let documentsInstance: LocalForage | undefined
let vectorsInstance: LocalForage | undefined
let changes: BroadcastChannel | undefined

/** The stores open on first use, so importing the memory modules opens no database. */
function documents() {
  documentsInstance ??= createAccountLocalForage('airi-character-memory', 'documents')
  return documentsInstance
}

function vectors() {
  vectorsInstance ??= createAccountLocalForage('airi-character-memory-vectors', 'vectors')
  return vectorsInstance
}

function changeChannel() {
  changes ??= new BroadcastChannel(getAccountScope().lockName('airi:character-memory-changes'))
  return changes
}

/**
 * Writes take two Web Locks: the account lock in shared mode, then the lock of the character.
 * Writes of different characters run in parallel, and writes of one character never lose each other's changes.
 * Clearing all memory takes the account lock in exclusive mode, so it waits for running writes and blocks new ones.
 * Both lock names hold the account, so work of an old account can never hold the lock of a new one.
 */
function accountLock() {
  return getAccountScope().lockName('airi:character-memory-account')
}

function characterLock(characterId: string) {
  return getAccountScope().lockName(`airi:character-memory-write:${characterId}`)
}

async function write(characterId: string, current: CharacterMemoryDocument, next: CharacterMemoryDocument) {
  if (next === current)
    return current
  await documents().setItem(characterId, next)
  changeChannel().postMessage({ characterId, revision: next.revision } satisfies CharacterMemoryChange)
  return next
}

function withWriteLock<T>(characterId: string, write: () => Promise<T>): Promise<T> {
  return navigator.locks.request(accountLock(), { mode: 'shared' }, () => navigator.locks.request(characterLock(characterId), write))
}

/**
 * Long-term memory of each character, one record per character in the account database.
 *
 * Reads take no lock, because a write replaces the whole record. Writes read, change, and write back inside the locks.
 */
export const characterMemoryRepo = {
  async get(characterId: string): Promise<CharacterMemoryDocument | null> {
    return documents().getItem<CharacterMemoryDocument>(characterId)
  },

  /** Ids of every character that has a memory record. Startup replays their pending work. */
  async listCharacterIds(): Promise<string[]> {
    return documents().keys()
  },

  /**
   * Returns the stored record. A character without one gets a new record, written at once,
   * so its automatic extraction start stays at the time of first use.
   */
  async getOrCreate(characterId: string): Promise<CharacterMemoryDocument> {
    const stored = await documents().getItem<CharacterMemoryDocument>(characterId)
    if (stored)
      return stored
    return withWriteLock(characterId, async () => {
      const current = await documents().getItem<CharacterMemoryDocument>(characterId)
      if (current)
        return current
      const created = createMemoryDocument(characterId, Date.now())
      await documents().setItem(characterId, created)
      return created
    })
  },

  /**
   * Applies `change` to the stored record, or to a new record when none exists, and writes the result.
   * `change` receives a fresh read inside the locks. Returning the same record skips the write.
   * A user edit creates the record. Use {@link updateExisting} for background work.
   */
  async update(characterId: string, change: (document: CharacterMemoryDocument) => CharacterMemoryDocument): Promise<CharacterMemoryDocument> {
    return withWriteLock(characterId, async () => {
      const current = await documents().getItem<CharacterMemoryDocument>(characterId) ?? createMemoryDocument(characterId, Date.now())
      return write(characterId, current, change(current))
    })
  },

  /**
   * Applies `change` only when the record still exists. Returns `null` otherwise.
   * Background work, such as an extraction commit, uses it: a record that "Delete all data" or a card deletion
   * removed while the work ran stays removed.
   */
  async updateExisting(characterId: string, change: (document: CharacterMemoryDocument) => CharacterMemoryDocument): Promise<CharacterMemoryDocument | null> {
    return withWriteLock(characterId, async () => {
      const current = await documents().getItem<CharacterMemoryDocument>(characterId)
      return current ? write(characterId, current, change(current)) : null
    })
  },

  /** Deletes the memory and the vectors of a character. Its card was deleted. */
  async remove(characterId: string) {
    await withWriteLock(characterId, async () => {
      await documents().removeItem(characterId)
      await vectors().removeItem(characterId)
      changeChannel().postMessage({ characterId, revision: -1 } satisfies CharacterMemoryChange)
    })
  },

  async getVectors(characterId: string): Promise<CharacterMemoryVectors | null> {
    return vectors().getItem<CharacterMemoryVectors>(characterId)
  },

  /**
   * Merges vectors into the record of `model`. Vectors of another model are replaced, never mixed.
   * Without a memory record, nothing is written, so late vectors cannot outlive a deletion.
   */
  async putVectors(characterId: string, model: string, entries: Record<string, number[]>) {
    await withWriteLock(characterId, async () => {
      if (!await documents().getItem(characterId))
        return
      const current = await vectors().getItem<CharacterMemoryVectors>(characterId)
      const kept = current?.model === model ? current.vectors : {}
      await vectors().setItem<CharacterMemoryVectors>(characterId, { model, vectors: { ...kept, ...entries } })
    })
  },

  /**
   * Deletes the memory of every character in this account. "Delete all data" calls it through the memory store.
   * It waits for running writes, and writes that start later find no record.
   */
  async clearAll() {
    await navigator.locks.request(accountLock(), { mode: 'exclusive' }, async () => {
      await documents().clear()
      await vectors().clear()
    })
  },

  /** Removes all vectors of a character, for example after the user clears its memory. */
  async clearVectors(characterId: string) {
    await withWriteLock(characterId, async () => {
      await vectors().removeItem(characterId)
    })
  },

  /** Removes vectors of deleted episodes. */
  async deleteVectors(characterId: string, episodeIds: readonly string[]) {
    await withWriteLock(characterId, async () => {
      const current = await vectors().getItem<CharacterMemoryVectors>(characterId)
      if (!current)
        return
      const remaining = Object.fromEntries(Object.entries(current.vectors).filter(([id]) => !episodeIds.includes(id)))
      await vectors().setItem<CharacterMemoryVectors>(characterId, { ...current, vectors: remaining })
    })
  },

  /** Calls `listener` for each change that another window writes. Returns the function that stops listening. */
  onChange(listener: (change: CharacterMemoryChange) => void) {
    const channel = new BroadcastChannel(getAccountScope().lockName('airi:character-memory-changes'))
    channel.onmessage = event => listener(event.data as CharacterMemoryChange)
    return () => channel.close()
  },
}
