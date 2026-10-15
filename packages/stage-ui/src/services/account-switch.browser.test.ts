import { CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'
import { initializeAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'

import {
  ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS,
  bindAccountToAuthentication,
  onBeforeAccountSwitch,
  reloadOnAccountPointerChange,
  switchAccount,
  useAccountSwitchConfirmation,
} from './account-switch'

// This file runs without the shared setup file. The page belongs to `alice`.
initializeAccountScope('alice')

beforeEach(() => {
  localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, 'alice')
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function pointer() {
  return localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)
}

describe('switchAccount', () => {
  it('writes the pointer only after pending writes finish, then reloads', async () => {
    const write = Promise.withResolvers<void>()
    const removeDrain = onBeforeAccountSwitch(() => write.promise)
    const reload = vi.fn()

    const switched = switchAccount('bob', reload)
    await Promise.resolve()
    expect(pointer()).toBe('alice')
    expect(reload).not.toHaveBeenCalled()

    write.resolve()
    await switched
    removeDrain()

    expect(pointer()).toBe('bob')
    expect(reload).toHaveBeenCalledExactlyOnceWith('bob')
  })

  it('does nothing when the target is the current account', async () => {
    const reload = vi.fn()

    await switchAccount('alice', reload)

    expect(reload).not.toHaveBeenCalled()
    expect(pointer()).toBe('alice')
  })

  it('rejects an invalid account ID without changing the pointer', async () => {
    const reload = vi.fn()

    await expect(switchAccount('..', reload)).rejects.toThrow('Invalid account')

    expect(reload).not.toHaveBeenCalled()
    expect(pointer()).toBe('alice')
  })

  it('keeps the pointer after the drain timeout until writes finish or the user forces the switch', async () => {
    vi.useFakeTimers()
    const write = Promise.withResolvers<void>()
    const removeDrain = onBeforeAccountSwitch(() => write.promise)
    const reload = vi.fn()
    const { confirmation } = useAccountSwitchConfirmation()

    const switched = switchAccount('bob', reload)
    try {
      await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS)

      expect(pointer()).toBe('alice')
      expect(reload).not.toHaveBeenCalled()
      expect(confirmation.value).toBe('prompt')
    }
    finally {
      write.resolve()
      await switched
      removeDrain()
    }
    expect(pointer()).toBe('bob')
    expect(reload).toHaveBeenCalledExactlyOnceWith('bob')
    expect(confirmation.value).toBe('closed')
  })

  it('keeps waiting on the original writes and leaves force available', async () => {
    vi.useFakeTimers()
    const write = Promise.withResolvers<void>()
    const drain = vi.fn(() => write.promise)
    const removeDrain = onBeforeAccountSwitch(drain)
    const reload = vi.fn()
    const { confirmation, wait, force } = useAccountSwitchConfirmation()
    const switched = switchAccount('bob', reload)

    try {
      await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS)
      wait()
      await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS * 2)

      expect(confirmation.value).toBe('waiting')
      expect(pointer()).toBe('alice')
      expect(reload).not.toHaveBeenCalled()
      expect(drain).toHaveBeenCalledOnce()

      write.resolve()
      await switched

      expect(confirmation.value).toBe('closed')
      expect(pointer()).toBe('bob')
      expect(reload).toHaveBeenCalledExactlyOnceWith('bob')
    }
    finally {
      force()
      await switched
      removeDrain()
    }
  })

  it.each([false, true])('forces an unfinished switch after the timeout with wait selected: %s', async (keepWaiting) => {
    vi.useFakeTimers()
    const write = Promise.withResolvers<void>()
    const removeDrain = onBeforeAccountSwitch(() => write.promise)
    const reload = vi.fn()
    const { confirmation, wait, force } = useAccountSwitchConfirmation()
    const switched = switchAccount('bob', reload)

    try {
      await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS)
      if (keepWaiting)
        wait()
      force()
      await switched

      expect(confirmation.value).toBe('closed')
      expect(pointer()).toBe('bob')
      expect(reload).toHaveBeenCalledExactlyOnceWith('bob')
    }
    finally {
      force()
      write.resolve()
      await switched
      removeDrain()
    }
  })

  it('clears the deadline when writes finish before the timeout', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    const { confirmation, wait, force } = useAccountSwitchConfirmation()

    wait()
    force()
    await switchAccount('bob', reload)
    await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS)

    expect(confirmation.value).toBe('closed')
    expect(vi.getTimerCount()).toBe(0)
    expect(reload).toHaveBeenCalledExactlyOnceWith('bob')
  })

  it('shares one switch between concurrent callers', async () => {
    const reload = vi.fn()

    await Promise.all([switchAccount('bob', reload), switchAccount('bob', reload)])

    expect(reload).toHaveBeenCalledOnce()
  })

  it('enters the latest target when a request arrives during the wait', async () => {
    const write = Promise.withResolvers<void>()
    const removeDrain = onBeforeAccountSwitch(() => write.promise)
    const reload = vi.fn()

    // A sign-out during a pending sign-in switch.
    const toBob = switchAccount('bob', reload)
    const toLocal = switchAccount('local', reload)
    write.resolve()
    await Promise.all([toBob, toLocal])
    removeDrain()

    expect(pointer()).toBe('local')
    expect(reload).toHaveBeenCalledExactlyOnceWith('local')
  })

  it('stays when the latest request returns to the current account', async () => {
    const write = Promise.withResolvers<void>()
    const removeDrain = onBeforeAccountSwitch(() => write.promise)
    const reload = vi.fn()

    const toBob = switchAccount('bob', reload)
    const back = switchAccount('alice', reload)
    write.resolve()
    await Promise.all([toBob, back])
    removeDrain()

    expect(pointer()).toBe('alice')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('reloadOnAccountPointerChange', () => {
  it('reloads only when another page selects another account', () => {
    const reload = vi.fn()
    const stop = reloadOnAccountPointerChange(reload)

    window.dispatchEvent(new StorageEvent('storage', { key: 'settings/language', newValue: 'en' }))
    window.dispatchEvent(new StorageEvent('storage', { key: CURRENT_ACCOUNT_STORAGE_KEY, newValue: 'alice' }))
    expect(reload).not.toHaveBeenCalled()

    window.dispatchEvent(new StorageEvent('storage', { key: CURRENT_ACCOUNT_STORAGE_KEY, newValue: null }))
    expect(reload).toHaveBeenCalledOnce()
    stop()
  })
})

describe('bindAccountToAuthentication', () => {
  function createAuth() {
    const user = shallowRef<{ id: string } | null>(null)
    let signOut: (() => void | Promise<void>) | undefined
    const auth = {
      get user() {
        return user.value
      },
      onSignOut: (hook: () => void | Promise<void>) => {
        signOut = hook
        return () => {
          signOut = undefined
        }
      },
    }
    return { auth, user, signOut: () => signOut?.(), hasSignOutHook: () => signOut !== undefined }
  }

  it('keeps the account for its own user and moves to another user', async () => {
    const { auth, user } = createAuth()
    const reload = vi.fn()
    const stop = bindAccountToAuthentication(auth, reload)

    user.value = { id: 'alice' }
    await nextTick()
    expect(pointer()).toBe('alice')

    user.value = { id: 'bob' }
    await vi.waitFor(() => expect(pointer()).toBe('bob'))
    expect(reload).toHaveBeenCalledOnce()
    stop()
  })

  // ROOT CAUSE:
  //
  // `onLogout` also runs when the server rejects the credentials. A switch on
  // that hook would move an offline user out of their account at startup.
  //
  // We fixed this by switching to `local` only on the explicit sign-out hook.
  it('keeps the account when credentials are cleared, and moves to local on sign-out', async () => {
    const { auth, user, signOut, hasSignOutHook } = createAuth()
    const reload = vi.fn()
    const stop = bindAccountToAuthentication(auth, reload)

    user.value = { id: 'alice' }
    await nextTick()
    user.value = null
    await nextTick()
    expect(pointer()).toBe('alice')
    expect(reload).not.toHaveBeenCalled()

    await signOut()
    expect(pointer()).toBe('local')
    expect(reload).toHaveBeenCalledExactlyOnceWith('local')

    stop()
    expect(hasSignOutHook()).toBe(false)
  })
})
