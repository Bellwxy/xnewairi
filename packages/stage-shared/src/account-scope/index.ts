/** Device-wide pointer. Hosts read it before constructing stores or opening databases. */
export const CURRENT_ACCOUNT_STORAGE_KEY = 'airi/account/current'

const deviceStorageKeys = new Set([
  CURRENT_ACCOUNT_STORAGE_KEY,
  'auth/v1/token',
  'auth/v1/refresh-token',
  'auth/v1/oidc-id-token',
  'auth/v1/oidc-client-id',
  'auth/v1/oidc-token-expiry',
  'auth/v1/oidc-flow-state',
  'auth/v1/oidc-flow-params',
  'settings/audio/input',
  'airi:debug:pinia-tracing',
  'airi:openpanel-device-id',
  // `@proj-airi/ui` stores the color mode at module evaluation, before any account scope exists.
  'vueuse-color-scheme',
])

/**
 * Logical names of every IndexedDB database that belongs to an account.
 * Deleting the data of an account deletes each one. Add a name here when a store opens a new account database.
 */
export const ACCOUNT_DATABASE_NAMES = ['airi-local', 'airi-sync-queue', 'airi-chat-assets', 'airi-stickers', 'airi-character-memory', 'airi-character-memory-vectors', 'localforage'] as const

/** One logical account database name. `databaseName` accepts only these, so the list above stays complete. */
export type AccountDatabaseName = typeof ACCOUNT_DATABASE_NAMES[number]

/** Unknown keys belong to the account, including new keys beside device-owned keys. */
export function isDeviceStorageKey(key: string): boolean {
  return deviceStorageKeys.has(key)
}

/**
 * Immutable names for one page lifetime. This module does not read storage or change authentication.
 * Hosts create a new scope after an account switch and reload, never mutate an existing scope.
 */
export class AccountScope {
  readonly #accountId: string
  readonly #encodedAccountId: string

  constructor(accountId: string) {
    if (!accountId.trim() || accountId === '.' || accountId === '..')
      throw new Error('Invalid account ID')

    this.#accountId = accountId
    this.#encodedAccountId = encodeURIComponent(accountId)
  }

  /** Only a missing pointer selects local. Invalid persisted values must stop startup. */
  static fromPointer(pointer: string | null): AccountScope {
    return new AccountScope(pointer ?? 'local')
  }

  /**
   * Reads the account of a directory or name suffix that {@link directoryName} created.
   * Returns undefined for any other name, so foreign entries are never treated as accounts.
   */
  static fromDirectoryName(directoryName: string): AccountScope | undefined {
    try {
      const scope = new AccountScope(decodeURIComponent(directoryName))
      return scope.directoryName === directoryName ? scope : undefined
    }
    catch {
      return undefined
    }
  }

  get accountId(): string {
    return this.#accountId
  }

  /**
   * Names the account directory in OPFS and in the Electron user data directory.
   * @example
   * new AccountScope('u/1').directoryName // u%2F1
   */
  get directoryName(): string {
    return this.#encodedAccountId
  }

  /**
   * Accepts an unscoped key. Already scoped keys are rejected to prevent accidental cross-account access.
   * @example
   * new AccountScope('u/1').storageKey('airi-cards') // account/u%2F1/airi-cards
   */
  storageKey(key: string): string {
    if (!key || key.startsWith('account/'))
      throw new Error('Expected an unscoped storage key')

    if (isDeviceStorageKey(key))
      return key

    return `account/${this.#encodedAccountId}/${key}`
  }

  /**
   * Names an account-owned IndexedDB database, including localforage databases.
   * Public model caches do not use this method.
   * @example
   * new AccountScope('u/1').databaseName('airi-local') // airi-local@u%2F1
   */
  databaseName(name: AccountDatabaseName): string {
    return `${name}@${this.#encodedAccountId}`
  }

  /**
   * Names an account-owned Web Lock. Callers supply the logical task name, not another scoped name.
   * @example
   * new AccountScope('u/1').lockName('memory-write') // memory-write@u%2F1
   */
  lockName(name: string): string {
    if (!name)
      throw new Error('Expected a lock name')

    return `${name}@${this.#encodedAccountId}`
  }
}
