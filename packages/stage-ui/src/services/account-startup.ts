import localeMessages from '@proj-airi/i18n/locales'

import { errorMessageFrom } from '@moeru/std'
import { AccountScope, CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'
import { initializeAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { object, safeParse, string } from 'valibot'

import { migrateAccountData } from './account-migration'
import { reloadOnAccountPointerChange } from './account-switch'

/**
 * Runs before dynamic import of the application, including modules with top-level storage refs.
 * Migration failure blocks startup. Authentication failures never replace the persisted identity.
 */
export async function initializeAccountStorage(): Promise<AccountScope> {
  const pointer = localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)
  const scope = AccountScope.fromPointer(pointer)
  await migrateAccountData()
  const currentPointer = localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)
  if (AccountScope.fromPointer(currentPointer).accountId !== scope.accountId)
    throw new Error('The current account changed during startup. Reload the page.')

  if (currentPointer === null)
    localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, scope.accountId)

  return initializeAccountScope(scope.accountId)
}

/** How a host page enters its account. */
export interface AccountStartupOptions {
  /**
   * The account that the host owns, for example the Electron main process. The page adopts it.
   * Omit it in a browser, where the page pointer decides.
   */
  accountId?: string
  /**
   * Reload this page when another page changes the pointer. Defaults to `true`.
   * Electron relaunches the whole app instead, so its pages turn this off.
   */
  followPointerChanges?: boolean
}

/**
 * Entry point of a host page. Fixes the account, then imports the application.
 * The application module must hold every import that can read storage.
 *
 * Use when: a host page renders the application, for example `main.ts` of stage-tamagotchi.
 * Expects: `loadApplication` dynamically imports the module that creates the Vue app.
 *
 * @example
 * void startWithAccountStorage(() => import('./bootstrap'))
 */
export async function startWithAccountStorage(loadApplication: () => Promise<unknown>, options: AccountStartupOptions = {}): Promise<void> {
  try {
    if (options.accountId !== undefined)
      localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, new AccountScope(options.accountId).accountId)
    await initializeAccountStorage()
  }
  catch (error) {
    console.error('[account-startup] Failed to prepare account storage:', errorMessageFrom(error))
    showStartupFailure()
    return
  }

  // Another window can move the device to another account later. This page then reloads into it.
  if (options.followPointerChanges ?? true)
    reloadOnAccountPointerChange()
  await loadApplication()
}

const startupMessagesSchema = object({ stage: object({ startup: object({ failed: string() }) }) })

/**
 * Shows the failure in the boot splash of stage-web and stage-pocket. Hosts without the splash get a plain message.
 * No store can start, so this reads the browser language instead of the saved language setting.
 */
function showStartupFailure() {
  const splash = document.querySelector('#boot-splash')
  if (splash) {
    splash.classList.add('failed')
    splash.setAttribute('aria-busy', 'false')
    return
  }

  const language = navigator.language
  const locales = localeMessages as Record<string, unknown>
  const parsed = [language, language.split('-')[0], language.startsWith('zh') ? 'zh-Hans' : undefined, 'en']
    .map(candidate => candidate ? safeParse(startupMessagesSchema, locales[candidate]) : undefined)
    .find(result => result?.success)

  const element = document.createElement('p')
  element.setAttribute('role', 'alert')
  element.textContent = parsed?.success ? parsed.output.stage.startup.failed : 'Startup failed'
  // UnoCSS loads with the application module, so this message styles itself.
  element.style.cssText = 'margin: 2rem; font-family: system-ui, sans-serif;'
  document.body.replaceChildren(element)
}
