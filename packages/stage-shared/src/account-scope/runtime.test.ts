import { accountStorageKey, getAccountScope, initializeAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { expect, it } from 'vitest'

it('requires startup initialization and prevents writes from following a later account switch', () => {
  expect(() => getAccountScope()).toThrow('initialized')
  expect(() => accountStorageKey('airi-cards')).toThrow('initialized')

  const first = initializeAccountScope('alice')

  expect(getAccountScope()).toBe(first)
  expect(initializeAccountScope('alice')).toBe(first)
  expect(accountStorageKey('airi-cards')).toBe('account/alice/airi-cards')
  expect(() => initializeAccountScope('bob')).toThrow('reload')
  expect(accountStorageKey('airi-cards')).toBe('account/alice/airi-cards')
})
