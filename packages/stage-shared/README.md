# `@proj-airi/stage-shared`

Shared contracts and runtime-neutral helpers for AIRI stage applications and UI packages.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `model-assets` entrypoint owns model file manifests, download status, and
the storage adapter contract. Use a platform adapter to store and open files.
It does not own a recognizer or Worker.

## Account scope

The `account-scope` entrypoint defines storage names for one account without accessing storage or authentication.
Create `AccountScope` from the device pointer before opening account stores. Keep that instance for the page lifetime.

```ts
import { AccountScope, CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'

const scope = AccountScope.fromPointer(localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY))
const cardsKey = scope.storageKey('airi-cards')
const databaseName = scope.databaseName('airi-local')
```

Only a missing pointer selects `local`. Invalid pointers throw instead of selecting another identity.
Unknown localStorage keys belong to the account. Only exact device keys bypass the prefix.
Audio device selection is shared, but microphone enablement remains account-owned.
The color mode of `@proj-airi/ui` is shared. Applications without accounts load that package, and it reads the mode at import.

Do not use `databaseName` for public model caches or use these names as an operating-system security boundary.

The `account-scope/runtime` entrypoint holds the initialized scope without accessing browser APIs.
Host entrypoints call `initializeAccountScope` once through `startWithAccountStorage` in `@proj-airi/stage-ui`.
`accountStorageKey` rejects calls before initialization.
Initializing another identity in the same runtime throws. Old tasks therefore cannot follow a changed pointer into another account.

Use these helpers for account data. Each one reads the scope that startup fixed:

| Storage | Helper |
| --- | --- |
| A Vue ref in localStorage | `useAccountLocalStorage` or `useLocalStorageManualReset` from `composables` |
| A direct localStorage read or write | `accountStorageKey(key)` from `account-scope/runtime` |
| A localforage database | `createAccountLocalForage(name, storeName)` or `accountDefaultLocalForage()` from `account-scope/localforage` |
| An OPFS directory | `getAccountOpfsRoot()` from `account-scope/opfs` |
| A Web Lock | `getAccountScope().lockName(name)` |

Pass logical names. Device keys keep their names. The helpers have no import side effects.

Tests of packages that load stores add `@proj-airi/stage-shared/account-scope/testing` to `setupFiles`.
It fixes the `local` account. A test of another account uses `AccountScope` directly.

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.
