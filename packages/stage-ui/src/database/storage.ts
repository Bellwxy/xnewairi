import indexedDbDriver from 'unstorage/drivers/indexedb'
import memoryDriver from 'unstorage/drivers/memory'

import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { createStorage } from 'unstorage'

export const storage = createStorage({
  driver: memoryDriver(),
})

// `base` is a key prefix, not a database name. Each mount opens its own account database.
// The key prefixes stay the same, so records that the account migration copied keep their keys.
const scope = getAccountScope()
storage.mount('local', indexedDbDriver({ base: 'airi-local', dbName: scope.databaseName('airi-local'), storeName: 'keyval' }))
storage.mount('outbox', indexedDbDriver({ base: 'airi-sync-queue', dbName: scope.databaseName('airi-sync-queue'), storeName: 'keyval' }))
