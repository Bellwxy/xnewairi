import type { AccountDatabaseName } from './index'

import localforage from 'localforage'

import { getAccountScope } from './runtime'

/**
 * Opens a localforage database of the account fixed at startup. Pass the logical database name.
 *
 * @example
 * createAccountLocalForage('airi-stickers', 'images') // database `airi-stickers@<account>`
 */
export function createAccountLocalForage(name: AccountDatabaseName, storeName: string): LocalForage {
  return localforage.createInstance({ name: getAccountScope().databaseName(name), storeName })
}

let defaultInstance: LocalForage | undefined

/**
 * The account copy of the localforage default instance.
 * Display models, backgrounds and MMD motions share it, as they shared the default instance before.
 * The account scope does not change during a page lifetime, so one instance serves the page.
 */
export function accountDefaultLocalForage(): LocalForage {
  defaultInstance ??= createAccountLocalForage('localforage', 'keyvaluepairs')
  return defaultInstance
}
