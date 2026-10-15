import type { Page } from 'playwright'

import { AccountScope, CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'

/**
 * Reads the account that the AIRI page fixed at startup.
 * Code inside `page.evaluate` cannot import the account scope module, so callers compute
 * account key and database names with the returned scope and pass them in as arguments.
 */
export async function pageAccountScope(page: Page): Promise<AccountScope> {
  return AccountScope.fromPointer(await page.evaluate(key => localStorage.getItem(key), CURRENT_ACCOUNT_STORAGE_KEY))
}
