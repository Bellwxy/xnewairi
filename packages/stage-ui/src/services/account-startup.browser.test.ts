import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { clear, createStore } from 'idb-keyval'
import { afterEach, expect, it } from 'vitest'

import { initializeAccountStorage } from './account-startup'

afterEach(async () => {
  localStorage.clear()
  await clear(createStore('keyval-store', 'keyval'))
})

it('rejects invalid pointers, fixes offline identity and rejects in-page account changes', async () => {
  localStorage.clear()
  await clear(createStore('keyval-store', 'keyval'))
  localStorage.setItem('airi/account/current', '')
  await expect(initializeAccountStorage()).rejects.toThrow('Invalid account')
  expect(localStorage.getItem('airi/account/current')).toBe('')

  localStorage.setItem('airi/account/current', 'alice')
  const scope = await initializeAccountStorage()

  expect(scope.accountId).toBe('alice')
  expect(localStorage.getItem('auth/v1/token')).toBeNull()
  expect(getAccountScope()).toBe(scope)
  expect(await initializeAccountStorage()).toBe(scope)

  localStorage.setItem('airi/account/current', 'bob')
  await expect(initializeAccountStorage()).rejects.toThrow('reload')
  expect(getAccountScope().accountId).toBe('alice')
})
