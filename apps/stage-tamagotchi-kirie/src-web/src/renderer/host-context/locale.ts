import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'

const localeStorageKey = 'settings/language'

export interface HostLocale {
  get: () => Promise<string | undefined>
  set: (locale: string) => Promise<void>
}

export function useHostLocale(): HostLocale {
  return {
    async get() {
      return localStorage.getItem(accountStorageKey(localeStorageKey)) || undefined
    },
    async set(locale) {
      localStorage.setItem(accountStorageKey(localeStorageKey), locale)
    },
  }
}
