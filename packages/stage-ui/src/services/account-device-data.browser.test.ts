import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteDeviceAccountData, listDeviceAccounts, registerAccountHostData } from './account-device-data'

/** Opens a database, runs one request, and closes the connection, as a page of another account would leave it. */
function withDatabase<T>(name: string, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name)
    open.onupgradeneeded = () => open.result.createObjectStore('keyval')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result
      const request = run(database.transaction('keyval', 'readwrite').objectStore('keyval'))
      request.onsuccess = () => {
        database.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
    }
  })
}

// The shared setup file fixes this page in the `local` account.
async function seedAccount(accountId: string) {
  const encoded = encodeURIComponent(accountId)
  localStorage.setItem(`account/${encoded}/airi-cards`, accountId)
  await withDatabase(`airi-local@${encoded}`, store => store.put(accountId, 'airi-local:chat:index:x'))
  const accounts = await (await navigator.storage.getDirectory()).getDirectoryHandle('accounts', { create: true })
  const directory = await accounts.getDirectoryHandle(encoded, { create: true })
  const writer = await (await directory.getFileHandle('model.json', { create: true })).createWritable()
  await writer.write(accountId)
  await writer.close()
}

async function opfsAccounts() {
  const accounts = await (await navigator.storage.getDirectory()).getDirectoryHandle('accounts', { create: true })
  const names: string[] = []
  for await (const entry of accounts.values())
    names.push(entry.name)
  return names.sort()
}

afterEach(async () => {
  localStorage.clear()
  const root = await navigator.storage.getDirectory()
  await root.removeEntry('accounts', { recursive: true }).catch(() => {})
  await Promise.all((await indexedDB.databases()).map(({ name }) => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name!)
    request.onsuccess = request.onerror = request.onblocked = resolve
  })))
})

describe('device account data', () => {
  it('lists the current account first and every account with local data', async () => {
    await seedAccount('user/1')
    localStorage.setItem('account/bob/settings/language', 'en')

    const accounts = await listDeviceAccounts()

    expect(accounts[0]).toBe('local')
    expect(accounts.toSorted()).toEqual(['bob', 'local', 'user/1'])
  })

  it('deletes every local copy of another account and keeps the current account', async () => {
    await seedAccount('local')
    await seedAccount('user/1')

    await deleteDeviceAccountData('user/1')

    expect(localStorage.getItem('account/user%2F1/airi-cards')).toBeNull()
    expect(localStorage.getItem('account/local/airi-cards')).toBe('local')
    expect((await indexedDB.databases()).map(database => database.name)).not.toContain('airi-local@user%2F1')
    expect(await withDatabase('airi-local@local', store => store.get('airi-local:chat:index:x'))).toBe('local')
    expect(await opfsAccounts()).toEqual(['local'])
    expect(await listDeviceAccounts()).toEqual(['local'])
  })

  it('refuses to delete the current account', async () => {
    await seedAccount('local')

    await expect(deleteDeviceAccountData('local')).rejects.toThrow('current account')

    expect(localStorage.getItem('account/local/airi-cards')).toBe('local')
  })

  it('includes and deletes the host data of an account', async () => {
    const remove = vi.fn(async () => {})
    const unregister = registerAccountHostData({ list: async () => ['carol'], delete: remove })

    expect(await listDeviceAccounts()).toEqual(['local', 'carol'])
    await deleteDeviceAccountData('carol')
    unregister()

    expect(remove).toHaveBeenCalledExactlyOnceWith('carol')
    expect(await listDeviceAccounts()).toEqual(['local'])
  })
})
