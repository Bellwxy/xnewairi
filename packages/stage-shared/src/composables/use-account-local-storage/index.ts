import type { RemovableRef, UseStorageOptions } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'

import { useLocalStorage } from '@vueuse/core'
import { toValue } from 'vue'

import { accountStorageKey } from '../../account-scope/runtime'

/**
 * `useLocalStorage` for the account fixed at startup. Pass the logical key.
 * Device keys keep their name, other keys get the account prefix.
 *
 * Use when: an application store or component persists a setting.
 * Expects: host startup has initialized the account scope.
 *
 * @example
 * const rate = useAccountLocalStorage('settings/speech/rate', 1)
 */
export function useAccountLocalStorage<T>(
  key: MaybeRefOrGetter<string>,
  initialValue: MaybeRefOrGetter<T>,
  options?: UseStorageOptions<T>,
): RemovableRef<T> {
  return useLocalStorage<T>(() => accountStorageKey(toValue(key)), initialValue, options)
}
