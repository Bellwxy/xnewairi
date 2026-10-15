import localforage from 'localforage'

import { clear, createStore, get, set } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateAccountData } from './account-migration'

const oldStore = createStore('keyval-store', 'keyval')
const aliceStore = createStore('airi-local@alice', 'keyval')
const bobStore = createStore('airi-local@bob', 'keyval')
const guestStore = createStore('airi-local@local', 'keyval')
const oldAssets = localforage.createInstance({ name: 'airi-chat-assets', storeName: 'assets' })
const aliceAssets = localforage.createInstance({ name: 'airi-chat-assets@alice', storeName: 'assets' })
const bobAssets = localforage.createInstance({ name: 'airi-chat-assets@bob', storeName: 'assets' })

async function clean() {
  localStorage.clear()
  const root = await navigator.storage.getDirectory()
  for await (const entry of root.values())
    await root.removeEntry(entry.name, { recursive: true })
  for (const store of [oldStore, aliceStore, bobStore, guestStore])
    await clear(store)
  for (const name of ['localforage', 'airi-stickers', 'airi-chat-assets']) {
    const storeNames = name === 'airi-stickers' ? ['entries', 'images'] : [name === 'localforage' ? 'keyvaluepairs' : 'assets']
    for (const storeName of storeNames) {
      for (const suffix of ['', '@local', '@alice', '@bob'])
        await localforage.createInstance({ name: `${name}${suffix}`, storeName }).clear()
    }
  }
}

beforeEach(clean)
afterEach(clean)

async function seedChat(accountId: string, sessionId: string) {
  const meta = { userId: accountId, sessionId, characterId: 'default', createdAt: 1, updatedAt: 1 }
  await set(`airi-local:chat:index:${accountId}`, { userId: accountId, characters: { default: { activeSessionId: sessionId, sessions: { [sessionId]: meta } } } }, oldStore)
  await set(`airi-local:chat:sessions:${sessionId}`, { meta, messages: [{ role: 'user', content: accountId }] }, oldStore)
}

describe('account data upgrade', () => {
  it('moves legacy settings to local and preserves the pointer and credentials', async () => {
    localStorage.setItem('airi/account/current', 'alice')
    localStorage.setItem('auth/v1/token', 'token')
    localStorage.setItem('settings/audio/input', 'microphone')
    localStorage.setItem('settings/audio/input/enabled', 'true')
    localStorage.setItem('airi-cards', 'guest-card')
    await migrateAccountData()

    expect(localStorage.getItem('airi/account/current')).toBe('alice')
    expect(localStorage.getItem('auth/v1/token')).toBe('token')
    expect(localStorage.getItem('settings/audio/input')).toBe('microphone')
    expect(localStorage.getItem('account/local/settings/audio/input/enabled')).toBe('true')
    expect(localStorage.getItem('account/local/airi-cards')).toBe('guest-card')
    expect(localStorage.getItem('account/alice/airi-cards')).toBeNull()
    expect(localStorage.getItem('airi-cards')).toBeNull()
  })

  it('routes real-account chats, queues and shared attachments without sharing owners', async () => {
    await seedChat('alice', 'session-a')
    await seedChat('bob', 'session-b')
    await set('airi-local:chat:tombstones:alice', ['deleted-cloud-chat'], oldStore)
    await set('airi-local:chat:outbox:bob', [{ messageId: 'pending' }], oldStore)
    await oldAssets.setItem('asset', { blob: new Blob(['image']), mimeType: 'image/png', owners: ['session-a', 'session-b'] })

    await migrateAccountData()

    expect(await get('airi-local:chat:index:alice', aliceStore)).toMatchObject({ userId: 'alice' })
    expect(await get('airi-local:chat:sessions:session-a', aliceStore)).toMatchObject({ meta: { userId: 'alice' } })
    expect(await get('airi-local:chat:sessions:session-a', bobStore)).toBeUndefined()
    expect(await get('airi-local:chat:sessions:session-b', guestStore)).toBeUndefined()
    expect(await get('airi-local:chat:tombstones:alice', aliceStore)).toEqual(['deleted-cloud-chat'])
    expect(await get('airi-local:chat:outbox:bob', bobStore)).toEqual([{ messageId: 'pending' }])
    expect(await aliceAssets.getItem('asset')).toMatchObject({ owners: ['session-a'] })
    expect(await bobAssets.getItem('asset')).toMatchObject({ owners: ['session-b'] })
    expect(await oldAssets.getItem('asset')).toBeNull()
    expect(await get('airi-local:chat:index:alice', oldStore)).toBeUndefined()
  })

  it('copies imported models, backgrounds and stickers into local', async () => {
    const models = localforage.createInstance({ name: 'localforage', storeName: 'keyvaluepairs' })
    const stickers = localforage.createInstance({ name: 'airi-stickers', storeName: 'images' })
    await models.setItem('display-model-custom', { file: new Blob(['model']) })
    await models.setItem('bg-custom', { blob: new Blob(['background']) })
    await stickers.setItem('sticker', new Blob(['sticker']))

    await migrateAccountData()

    const localModels = localforage.createInstance({ name: 'localforage@local', storeName: 'keyvaluepairs' })
    const localStickers = localforage.createInstance({ name: 'airi-stickers@local', storeName: 'images' })
    expect(await localModels.keys()).toEqual(['bg-custom', 'display-model-custom'])
    expect(await (await localStickers.getItem<Blob>('sticker'))?.text()).toBe('sticker')
    expect(await models.keys()).toEqual([])
  })

  it('keeps sources after a failed copy and resumes the same journal', async () => {
    await seedChat('alice', 'session-a')
    await oldAssets.setItem('asset', { blob: 'invalid', owners: ['session-a'] })

    await expect(migrateAccountData()).rejects.toThrow('Invalid chat asset')
    expect(await get('airi-local:chat:sessions:session-a', oldStore)).toBeDefined()
    expect(await get('airi-account-migration-v1', oldStore)).toMatchObject({ phase: 'copying' })

    await oldAssets.setItem('asset', { blob: new Blob(['image']), mimeType: 'image/png', owners: ['session-a'] })
    await migrateAccountData()

    expect(await get('airi-local:chat:sessions:session-a', aliceStore)).toBeDefined()
    expect(await get('airi-local:chat:sessions:session-a', oldStore)).toBeUndefined()
  })

  it('does not overwrite a localStorage conflict or delete its source', async () => {
    localStorage.setItem('airi-cards', 'old')
    localStorage.setItem('account/local/airi-cards', 'new')

    await expect(migrateAccountData()).rejects.toThrow('conflicts')

    expect(localStorage.getItem('airi-cards')).toBe('old')
    expect(localStorage.getItem('account/local/airi-cards')).toBe('new')
  })

  it('serializes simultaneous windows and never replays completed migration', async () => {
    await seedChat('alice', 'session-a')
    await Promise.all([migrateAccountData(), migrateAccountData()])
    await set('airi-local:chat:sessions:session-a', { edited: true }, aliceStore)
    await migrateAccountData()

    expect(await get('airi-local:chat:sessions:session-a', aliceStore)).toEqual({ edited: true })
    expect(await get('airi-account-migration-v1', oldStore)).toEqual({ phase: 'complete', keys: [], sessionOwners: [], accountIds: [], opfsEntries: [] })
  })

  it('resumes cleanup without overwriting already copied destination data', async () => {
    await seedChat('alice', 'session-a')
    await set('airi-local:chat:sessions:session-a', { edited: true }, aliceStore)
    await set('airi-account-migration-v1', {
      phase: 'cleaning',
      keys: ['airi-local:chat:index:alice', 'airi-local:chat:sessions:session-a'],
      sessionOwners: [['session-a', 'alice']],
      accountIds: ['local', 'alice'],
      opfsEntries: ['already-removed'],
    }, oldStore)

    await migrateAccountData()

    expect(await get('airi-local:chat:sessions:session-a', aliceStore)).toEqual({ edited: true })
    expect(await get('airi-local:chat:sessions:session-a', oldStore)).toBeUndefined()
    expect(await get('airi-account-migration-v1', oldStore)).toMatchObject({ phase: 'complete' })
  })

  it('blocks ambiguous queue ownership without deleting source data', async () => {
    await set('airi-local:chat:outbox:missing-account', [{ messageId: 'pending' }], oldStore)

    await expect(migrateAccountData()).rejects.toThrow('Cannot determine the account')
    expect(await get('airi-local:chat:outbox:missing-account', oldStore)).toEqual([{ messageId: 'pending' }])
    expect(await get('airi-account-migration-v1', oldStore)).toMatchObject({ phase: 'copying' })
  })

  it('moves private OPFS files while retaining public inference models', async () => {
    const root = await navigator.storage.getDirectory()
    const model = await root.getDirectoryHandle('display-model-private', { create: true })
    const writer = await (await model.getFileHandle('model.json', { create: true })).createWritable()
    await writer.write('private model')
    await writer.close()
    await root.getDirectoryHandle('airi-model-assets', { create: true })

    await migrateAccountData()

    const accountRoot = await (await root.getDirectoryHandle('accounts')).getDirectoryHandle('local')
    const moved = await accountRoot.getDirectoryHandle('display-model-private')
    expect(await (await (await moved.getFileHandle('model.json')).getFile()).text()).toBe('private model')
    await expect(root.getDirectoryHandle('display-model-private')).rejects.toThrow()
    expect((await root.getDirectoryHandle('airi-model-assets')).name).toBe('airi-model-assets')
  })
})
