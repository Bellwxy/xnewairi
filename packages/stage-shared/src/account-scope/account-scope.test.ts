import { ACCOUNT_DATABASE_NAMES, AccountScope, isDeviceStorageKey } from '@proj-airi/stage-shared/account-scope'
import { describe, expect, it } from 'vitest'

describe('account scope', () => {
  it('uses local only when the pointer is missing', () => {
    expect(AccountScope.fromPointer(null).accountId).toBe('local')
    expect(AccountScope.fromPointer('local').storageKey('airi-cards')).toBe('account/local/airi-cards')
    expect(AccountScope.fromPointer('u123').accountId).toBe('u123')
  })

  it.each(['', ' ', '.', '..', '\uD800'])('rejects invalid pointer %j instead of falling back to local', (pointer) => {
    expect(() => AccountScope.fromPointer(pointer)).toThrow()
  })

  it('keeps an existing scope when the next page selects another account', () => {
    const previous = AccountScope.fromPointer('alice')
    const next = AccountScope.fromPointer('bob')

    expect(previous.storageKey('settings/credentials/providers')).toBe('account/alice/settings/credentials/providers')
    expect(next.storageKey('settings/credentials/providers')).toBe('account/bob/settings/credentials/providers')
    expect(previous.databaseName('airi-local')).toBe('airi-local@alice')
    expect(next.databaseName('airi-local')).toBe('airi-local@bob')
    expect(previous.lockName('memory-write/default')).toBe('memory-write/default@alice')
    expect(next.lockName('memory-write/default')).toBe('memory-write/default@bob')
  })

  it.each([
    ['u/1', 'u%2F1'],
    ['u%2F1', 'u%252F1'],
    ['u@1', 'u%401'],
    ['u\\1', 'u%5C1'],
    ['用户', '%E7%94%A8%E6%88%B7'],
  ])('encodes account ID %s without collisions', (accountId, encoded) => {
    const scope = new AccountScope(accountId)

    expect(scope.accountId).toBe(accountId)
    expect(scope.storageKey('airi-cards')).toBe(`account/${encoded}/airi-cards`)
    expect(scope.databaseName('airi-stickers')).toBe(`airi-stickers@${encoded}`)
    expect(scope.lockName('memory-write')).toBe(`memory-write@${encoded}`)
  })

  it.each([
    'airi/account/current',
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
    'vueuse-color-scheme',
  ])('preserves device key %s for both accounts', (key) => {
    expect(isDeviceStorageKey(key)).toBe(true)
    expect(new AccountScope('alice').storageKey(key)).toBe(key)
    expect(new AccountScope('bob').storageKey(key)).toBe(key)
  })

  it.each([
    'settings/audio/input/enabled',
    'settings/language',
    'settings/theme/colors/hue',
    'settings/credentials/providers',
    'auth/v1/new-setting',
    'airi/account/current-extra',
    'new-feature/state',
  ])('isolates undeclared key %s instead of sharing its prefix', (key) => {
    expect(isDeviceStorageKey(key)).toBe(false)
    expect(new AccountScope('alice').storageKey(key)).toBe(`account/alice/${key}`)
  })

  it('names every account database with the encoded account ID', () => {
    expect(ACCOUNT_DATABASE_NAMES.map(name => new AccountScope('u/1').databaseName(name)))
      .toEqual(ACCOUNT_DATABASE_NAMES.map(name => `${name}@u%2F1`))
  })

  it.each([
    ['u%2F1', 'u/1'],
    ['local', 'local'],
    ['u/1', undefined],
    ['%E0%A4%A', undefined],
    ['..', undefined],
    ['%2E%2E', undefined],
  ])('reads directory name %s as account %s', (directoryName, accountId) => {
    expect(AccountScope.fromDirectoryName(directoryName)?.accountId).toBe(accountId)
  })

  it('names the account directory with the encoded account ID', () => {
    expect(new AccountScope('u/1').directoryName).toBe('u%2F1')
    expect(new AccountScope('local').directoryName).toBe('local')
  })

  it('rejects empty names and already scoped localStorage keys', () => {
    const scope = new AccountScope('alice')

    expect(() => scope.storageKey('account/bob/airi-cards')).toThrow('unscoped')
    expect(() => scope.storageKey('account/alice/airi-cards')).toThrow('unscoped')
    expect(() => scope.storageKey('')).toThrow('unscoped')
    expect(() => scope.lockName('')).toThrow('lock')
  })
})
