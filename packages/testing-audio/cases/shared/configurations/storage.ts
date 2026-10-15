import type { AudioInputSession } from '../../../src/types'

import { pageAccountScope } from '../../../src/setup/account-scope'

/** Writes AIRI settings through the storage owned by the current runtime page. */
export async function configureStorage(
  runtime: AudioInputSession,
  settings: Record<string, string>,
): Promise<void> {
  // Callers pass logical keys. The page stores account settings under the account prefix.
  const scope = await pageAccountScope(runtime.runtimePage)
  const entries = Object.fromEntries(Object.entries(settings).map(([key, value]) => [scope.storageKey(key), value]))
  await runtime.runtimePage.evaluate(({ entries }) => {
    for (const [key, value] of Object.entries(entries))
      localStorage.setItem(key, value)
  }, { entries })
}
