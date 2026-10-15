import type { AccountDatabaseName } from '@proj-airi/stage-shared/account-scope'
import type { UseStore } from 'idb-keyval'

import localforage from 'localforage'

import { AccountScope, isDeviceStorageKey } from '@proj-airi/stage-shared/account-scope'
import { createStore, delMany, entries, get, set } from 'idb-keyval'
import { normalizeKey } from 'unstorage'
import { array, instance, literal, looseObject, parse, record, safeParse, string, tuple, union } from 'valibot'

const migrationKey = 'airi-account-migration-v1'
const migrationLock = 'airi:account-migration:v1'
const journalSchema = looseObject({
  phase: union([literal('copying'), literal('cleaning'), literal('complete')]),
  keys: array(string()),
  sessionOwners: array(tuple([string(), string()])),
  accountIds: array(string()),
  opfsEntries: array(string()),
})
const indexSchema = looseObject({ userId: string(), characters: record(string(), looseObject({ sessions: record(string(), looseObject({ userId: string() })) })) })
const sessionSchema = looseObject({ meta: looseObject({ userId: string(), sessionId: string() }) })
const assetSchema = looseObject({ blob: instance(Blob), mimeType: string(), owners: array(string()) })

/**
 * One-time upgrade before any store starts. The device lock excludes other windows.
 * The journal keeps ownership until every destination is copied, then cleanup can resume after a crash.
 * A failure leaves startup blocked, never silently selects another account or deletes uncopied data.
 */
export async function migrateAccountData(): Promise<void> {
  // NOTICE:
  // Older clients wrote account and guest data into shared browser stores.
  // The unstorage base is a key prefix, not a database name.
  // Source: unstorage/drivers/indexedb.mjs and docs/ai/plans/account-data-isolation-spec.md.
  // Remove after upgrades from the shared-storage release are no longer supported.
  await navigator.locks.request(migrationLock, async () => {
    const source = createStore('keyval-store', 'keyval')
    const saved = await get<unknown>(migrationKey, source)
    if (saved !== undefined && parse(journalSchema, saved).phase === 'complete')
      return

    const sourceEntries = (await entries<IDBValidKey, unknown>(source))
      .filter((entry): entry is [string, unknown] => typeof entry[0] === 'string')
    const accounts = new Set<string>(['local'])
    const sessionOwners = new Map<string, string>()
    for (const [key, value] of sourceEntries) {
      if (key.startsWith('airi-local:chat:index:')) {
        const index = parse(indexSchema, value)
        accounts.add(index.userId)
        for (const character of Object.values(index.characters)) {
          for (const [sessionId, meta] of Object.entries(character.sessions)) {
            if (meta.userId !== index.userId)
              throw new Error('Chat index has inconsistent account ownership')
            sessionOwners.set(sessionId, index.userId)
          }
        }
      }
      if (key.startsWith('airi-local:chat:sessions:')) {
        const { meta } = parse(sessionSchema, value)
        const owner = sessionOwners.get(meta.sessionId)
        if (owner !== undefined && owner !== meta.userId)
          throw new Error('Chat session has inconsistent account ownership')
        accounts.add(meta.userId)
        sessionOwners.set(meta.sessionId, meta.userId)
      }
    }

    // OPFS is an optional cache in the existing renderers. Unsupported hosts have no OPFS data to migrate.
    const opfs = navigator.storage?.getDirectory ? await navigator.storage.getDirectory() : undefined
    const opfsEntries: string[] = []
    if (opfs) {
      for await (const entry of opfs.values()) {
        if (entry.name !== 'accounts' && entry.name !== 'airi-model-assets')
          opfsEntries.push(entry.name)
      }
    }
    const journal = saved === undefined
      ? { phase: 'copying' as const, keys: sourceEntries.map(([key]) => key).filter(key => key.startsWith('airi-local:') || key.startsWith('airi-sync-queue:')), sessionOwners: [...sessionOwners], accountIds: [...accounts], opfsEntries }
      : parse(journalSchema, saved)
    await set(migrationKey, journal, source)

    if (journal.phase === 'copying') {
      const destinations = new Map<string, UseStore>()
      for (const key of journal.keys) {
        const value = await get<unknown>(key, source)
        if (value === undefined)
          throw new Error('Migration source disappeared before copy completed')
        const accountId = ownerOfRecord(key, value, journal.accountIds)
        const base = key.startsWith('airi-sync-queue:') ? 'airi-sync-queue' : 'airi-local'
        const name = new AccountScope(accountId).databaseName(base)
        let destination = destinations.get(name)
        if (!destination) {
          destination = createStore(name, 'keyval')
          destinations.set(name, destination)
        }
        await set(key, value, destination)
      }

      await copyLocalForage('localforage', 'keyvaluepairs')
      await copyLocalForage('airi-stickers', 'entries')
      await copyLocalForage('airi-stickers', 'images')
      await copyChatAssets(new Map(journal.sessionOwners))
      if (opfs && journal.opfsEntries.length) {
        const accountsRoot = await opfs.getDirectoryHandle('accounts', { create: true })
        const localRoot = await accountsRoot.getDirectoryHandle('local', { create: true })
        for (const name of journal.opfsEntries)
          await copyOpfsEntry(opfs, localRoot, name)
      }
      migrateLocalStorage()
      await set(migrationKey, { ...journal, phase: 'cleaning' }, source)
    }

    // No application writes are allowed before completion. Cleanup never repeats the copy phase.
    await delMany(journal.keys, source)
    await localforage.createInstance({ name: 'localforage', storeName: 'keyvaluepairs' }).clear()
    await localforage.createInstance({ name: 'airi-stickers', storeName: 'entries' }).clear()
    await localforage.createInstance({ name: 'airi-stickers', storeName: 'images' }).clear()
    await localforage.createInstance({ name: 'airi-chat-assets', storeName: 'assets' }).clear()
    if (opfs) {
      for (const name of journal.opfsEntries) {
        try {
          await opfs.removeEntry(name, { recursive: true })
        }
        catch (error) {
          // A previous cleanup can have removed this entry before the process stopped.
          if (!(error instanceof DOMException) || error.name !== 'NotFoundError')
            throw error
        }
      }
    }
    await set(migrationKey, { phase: 'complete', keys: [], sessionOwners: [], accountIds: [], opfsEntries: [] }, source)
  })
}

async function copyOpfsEntry(source: FileSystemDirectoryHandle, destination: FileSystemDirectoryHandle, name: string): Promise<void> {
  let directory: FileSystemDirectoryHandle
  try {
    directory = await source.getDirectoryHandle(name)
  }
  catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError')
      throw error
    const file = await (await source.getFileHandle(name)).getFile()
    const writable = await (await destination.getFileHandle(name, { create: true })).createWritable()
    try {
      await writable.write(file)
      await writable.close()
    }
    catch (writeError) {
      await writable.abort().catch(() => undefined)
      throw writeError
    }
    return
  }
  const target = await destination.getDirectoryHandle(name, { create: true })
  for await (const child of directory.values())
    await copyOpfsEntry(directory, target, child.name)
}

function ownerOfRecord(key: string, value: unknown, accounts: string[]): string {
  if (key.startsWith('airi-local:chat:index:'))
    return parse(indexSchema, value).userId
  if (key.startsWith('airi-local:chat:sessions:'))
    return parse(sessionSchema, value).meta.userId

  const accountKeyPrefixes = ['airi-local:chat:tombstones:', 'airi-local:chat:outbox:']
  for (const prefix of accountKeyPrefixes) {
    if (key.startsWith(prefix)) {
      const matches = accounts.filter(id => normalizeKey(`${prefix}${id}`) === key)
      if (matches.length !== 1)
        throw new Error('Cannot determine the account of a chat queue')
      return matches[0]
    }
  }
  // Card documents move to local. Old remote sync cursors must not attach them to a real account.
  return 'local'
}

async function copyLocalForage(name: AccountDatabaseName, storeName: string) {
  const source = localforage.createInstance({ name, storeName })
  const destination = localforage.createInstance({ name: new AccountScope('local').databaseName(name), storeName })
  for (const key of await source.keys()) {
    await destination.setItem(key, await source.getItem<unknown>(key))
  }
}

async function copyChatAssets(sessionOwners: Map<string, string>) {
  const source = localforage.createInstance({ name: 'airi-chat-assets', storeName: 'assets' })
  for (const key of await source.keys()) {
    const parsed = safeParse(assetSchema, await source.getItem<unknown>(key))
    if (!parsed.success)
      throw new Error('Invalid chat asset during account migration')
    const asset = parsed.output
    const ownersByAccount = new Map<string, string[]>()
    for (const owner of asset.owners) {
      const accountId = sessionOwners.get(owner) ?? 'local'
      const owners = ownersByAccount.get(accountId) ?? []
      owners.push(owner)
      ownersByAccount.set(accountId, owners)
    }
    if (!ownersByAccount.size)
      ownersByAccount.set('local', [])
    for (const [accountId, owners] of ownersByAccount) {
      const destination = localforage.createInstance({ name: new AccountScope(accountId).databaseName('airi-chat-assets'), storeName: 'assets' })
      await destination.setItem(key, { ...asset, owners })
    }
  }
}

function migrateLocalStorage() {
  const scope = new AccountScope('local')
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  for (const key of keys) {
    if (key === null || key.startsWith('account/') || isDeviceStorageKey(key))
      continue
    const value = localStorage.getItem(key)
    if (value === null)
      continue
    const destination = scope.storageKey(key)
    const existing = localStorage.getItem(destination)
    if (existing !== null && existing !== value)
      throw new Error(`Account migration conflicts with existing key: ${key}`)
    localStorage.setItem(destination, value)
    localStorage.removeItem(key)
  }
}
