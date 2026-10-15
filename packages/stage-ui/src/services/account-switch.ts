import type { WatchStopHandle } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { AccountScope, CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { readonly, shallowRef, watch } from 'vue'

/** A store writes its pending data before the page leaves the current account. */
export type AccountSwitchDrain = () => Promise<void>

/** Enters an account after the pointer changes. See {@link switchAccount}. */
export type AccountEntry = (accountId: string) => void | Promise<void>

/** After this wait, the user can continue to wait or force the switch. */
export const ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS = 5_000

const drains = new Set<AccountSwitchDrain>()
let switching: Promise<void> | undefined
// The latest request decides the account that the pending switch enters.
let pendingTarget: { accountId: string, enterAccount: AccountEntry } | undefined
// One page owns one switch. The dialog stays open after Wait, so Force remains available until writes settle.
const confirmation = shallowRef<'closed' | 'prompt' | 'waiting'>('closed')
let forcePendingSwitch: (() => void) | undefined

/**
 * Connects the host's confirmation dialog to its pending switch.
 * Waiting keeps the dialog open. Completed writes close it automatically, including before the user makes a choice.
 * Forcing permits page reload or app relaunch, which can interrupt unsaved writes.
 */
export function useAccountSwitchConfirmation() {
  function wait() {
    if (confirmation.value === 'prompt')
      confirmation.value = 'waiting'
  }

  function force() {
    forcePendingSwitch?.()
  }

  return { confirmation: readonly(confirmation), wait, force }
}

/**
 * Registers work that must finish before the page switches accounts, for example a queued IndexedDB write.
 * Writes target the previous account while this page exists. A forced reload can interrupt unfinished writes.
 *
 * @returns A function that removes the drain.
 */
export function onBeforeAccountSwitch(drain: AccountSwitchDrain): () => void {
  drains.add(drain)
  return () => drains.delete(drain)
}

async function drainBeforeAccountSwitch() {
  const writes = Promise.allSettled([...drains].map(drain => Promise.resolve().then(drain))).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected')
        console.error('[account-switch] A pending write failed:', errorMessageFrom(result.reason))
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(resolve, ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS, 'timeout')
  })

  try {
    if (await Promise.race([writes, timeout]) === 'timeout') {
      const forced = Promise.withResolvers<void>()
      forcePendingSwitch = () => forced.resolve()
      confirmation.value = 'prompt'
      await Promise.race([writes, forced.promise])
    }
  }
  finally {
    clearTimeout(timer)
    forcePendingSwitch = undefined
    confirmation.value = 'closed'
  }
}

/**
 * Moves the device to another account and enters it.
 * Other pages of this origin follow through {@link reloadOnAccountPointerChange}.
 *
 * Use when: a sign-in resolves another user, or the user signs out.
 * Expects: host startup has fixed the account of this page.
 *
 * @param accountId The user ID, or `local` for the signed-out identity.
 * @param enterAccount Enters the new account after the pointer changes. A browser reloads the page.
 * Electron relaunches the app through the main process. Tests replace it, because a test page cannot reload.
 */
export async function switchAccount(accountId: string, enterAccount: AccountEntry = () => location.reload()): Promise<void> {
  // Validates the ID before any drain runs, so an invalid ID changes nothing.
  const target = new AccountScope(accountId)
  if (!switching && target.accountId === getAccountScope().accountId)
    return

  // A later request replaces the target of a pending switch. For example, a sign-out during the wait enters `local`.
  pendingTarget = { accountId: target.accountId, enterAccount }
  switching ??= (async () => {
    await drainBeforeAccountSwitch()
    const { accountId, enterAccount } = pendingTarget!
    // The latest request returned to this account, so the page stays.
    if (accountId === getAccountScope().accountId)
      return
    localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, accountId)
    await enterAccount(accountId)
  })().finally(() => {
    // Entering the account ends this page. Clearing the promise lets a failed entry retry.
    switching = undefined
    pendingTarget = undefined
  })

  return switching
}

/**
 * Reloads this page when another page of this origin moves the device to another account.
 * The storage event reaches every other page, including the other Electron windows.
 *
 * @returns A function that removes the listener.
 */
export function reloadOnAccountPointerChange(reload: () => void = () => location.reload()): () => void {
  const current = getAccountScope().accountId
  const listener = (event: StorageEvent) => {
    if (event.key !== CURRENT_ACCOUNT_STORAGE_KEY)
      return
    // A removed pointer selects `local`, the same as at startup.
    if (AccountScope.fromPointer(event.newValue).accountId !== current)
      reload()
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

/** The members of the auth store that decide the account. */
export interface AccountAuthentication {
  readonly user: { id: string } | null
  onSignOut: (hook: () => void | Promise<void>) => () => void
}

/**
 * Keeps the page account equal to the signed-in user.
 *
 * - A resolved user with another ID switches to that user, also after an upgrade with a `local` pointer.
 * - An explicit sign-out switches to `local`.
 * - A rejected or expired credential keeps the account. The user signs in again in the same account.
 *
 * Call it in each host before `authStore.initialize()`.
 *
 * @param auth The auth store, or another source of the signed-in user and the sign-out hook.
 * @param enterAccount Enters the new account. See {@link switchAccount}.
 */
export function bindAccountToAuthentication(auth: AccountAuthentication, enterAccount?: AccountEntry): () => void {
  const stopUser: WatchStopHandle = watch(() => auth.user?.id, (userId) => {
    if (userId)
      void switchAccount(userId, enterAccount)
  }, { immediate: true })
  const stopSignOut = auth.onSignOut(() => switchAccount('local', enterAccount))

  return () => {
    stopUser()
    stopSignOut()
  }
}
