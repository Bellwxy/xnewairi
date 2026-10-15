import { ACCOUNT_DATABASE_NAMES, AccountScope } from '@proj-airi/stage-shared/account-scope'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'

/** Account data that a host keeps outside the page, for example the files of the Electron main process. */
export interface AccountHostData {
  /** IDs of the accounts that have host data on this device. */
  list: () => Promise<string[]>
  /** Deletes the host data of one account. It rejects the account of the running app. */
  delete: (accountId: string) => Promise<void>
}

let hostData: AccountHostData | undefined

/**
 * Registers the host data of this host. Electron registers its main-process files. A browser registers nothing.
 *
 * @returns A function that removes the registration.
 */
export function registerAccountHostData(data: AccountHostData): () => void {
  hostData = data
  return () => {
    if (hostData === data)
      hostData = undefined
  }
}

const STORAGE_PREFIX = 'account/'

function accountIdOfDirectory(directoryName: string): string | undefined {
  return AccountScope.fromDirectoryName(directoryName)?.accountId
}

async function accountsDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!navigator.storage?.getDirectory)
    return undefined
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle('accounts')
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError')
      return undefined
    throw error
  }
}

/**
 * Lists the accounts that keep data on this device, the current account first.
 * The list reads localStorage, IndexedDB, OPFS and the host data. Names are not stored, so it returns IDs.
 */
export async function listDeviceAccounts(): Promise<string[]> {
  const accounts = new Set<string>([getAccountScope().accountId])

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX))
      continue
    const accountId = accountIdOfDirectory(key.slice(STORAGE_PREFIX.length).split('/')[0])
    if (accountId)
      accounts.add(accountId)
  }

  for (const { name } of await indexedDB.databases()) {
    const base = ACCOUNT_DATABASE_NAMES.find(databaseName => name?.startsWith(`${databaseName}@`))
    const accountId = base && name ? accountIdOfDirectory(name.slice(base.length + 1)) : undefined
    if (accountId)
      accounts.add(accountId)
  }

  const directory = await accountsDirectory()
  if (directory) {
    for await (const entry of directory.values()) {
      const accountId = accountIdOfDirectory(entry.name)
      if (accountId)
        accounts.add(accountId)
    }
  }

  for (const accountId of await hostData?.list() ?? [])
    accounts.add(accountId)

  return [...accounts]
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    // A page of the deleted account is still open. The browser deletes the database when that page closes.
    request.onblocked = () => reject(new Error('A page of this account still uses its data. Close it and try again.'))
  })
}

/**
 * Deletes every local copy of the data of one account on this device: settings, keys, chats, memory and imported files.
 * Server data stays. The current account cannot be deleted, because its pages hold its data open.
 *
 * Use when: the user removes the data of another account, or of the signed-out identity, from this device.
 */
export async function deleteDeviceAccountData(accountId: string): Promise<void> {
  const scope = new AccountScope(accountId)
  if (scope.accountId === getAccountScope().accountId)
    throw new Error('The current account cannot delete its own data')

  const prefix = `${STORAGE_PREFIX}${scope.directoryName}/`
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  for (const key of keys) {
    if (key?.startsWith(prefix))
      localStorage.removeItem(key)
  }

  for (const name of ACCOUNT_DATABASE_NAMES)
    await deleteDatabase(scope.databaseName(name))

  const directory = await accountsDirectory()
  try {
    await directory?.removeEntry(scope.directoryName, { recursive: true })
  }
  catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError')
      throw error
  }

  await hostData?.delete(scope.accountId)
}
