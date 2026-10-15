import { AccountScope } from './index'

let currentScope: AccountScope | undefined

/**
 * Fixes the account for this runtime before stores are imported.
 * Repeated initialization of the same account is allowed. A different account requires a new page.
 */
export function initializeAccountScope(accountId: string): AccountScope {
  if (currentScope && currentScope.accountId !== accountId)
    throw new Error('An account switch requires a page reload')

  currentScope ??= new AccountScope(accountId)
  return currentScope
}

/** Fails closed if a store loads before host startup establishes its account. */
export function getAccountScope(): AccountScope {
  if (!currentScope)
    throw new Error('Account scope must be initialized before storage access')

  return currentScope
}

/** Converts a logical localStorage key using the account fixed at startup. */
export function accountStorageKey(key: string): string {
  return getAccountScope().storageKey(key)
}
