import { CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { clear, createStore } from 'idb-keyval'
import { afterEach, expect, it, vi } from 'vitest'

import { startWithAccountStorage } from './account-startup'

afterEach(async () => {
  localStorage.clear()
  document.querySelector('#boot-splash')?.remove()
  await clear(createStore('keyval-store', 'keyval'))
})

it('shows the boot splash error and does not load the application when the pointer is invalid', async () => {
  const splash = document.createElement('div')
  splash.id = 'boot-splash'
  splash.setAttribute('aria-busy', 'true')
  document.body.append(splash)
  localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, '..')
  const loadApplication = vi.fn(async () => {})

  await startWithAccountStorage(loadApplication)

  expect(loadApplication).not.toHaveBeenCalled()
  expect(splash.classList.contains('failed')).toBe(true)
  expect(splash.getAttribute('aria-busy')).toBe('false')
})

// ROOT CAUSE:
//
// Chromium writes localStorage to disk later. After an Electron relaunch, the
// page could start in the previous account while the main process used the new one.
//
// We fixed this by letting the host pass its account. The page adopts it.
it('adopts the account of the host before the application loads', async () => {
  localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, 'alice')
  const loadApplication = vi.fn(async () => {
    expect(getAccountScope().accountId).toBe('carol')
  })

  await startWithAccountStorage(loadApplication, { accountId: 'carol', followPointerChanges: false })

  expect(loadApplication).toHaveBeenCalledOnce()
  expect(localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)).toBe('carol')
})
