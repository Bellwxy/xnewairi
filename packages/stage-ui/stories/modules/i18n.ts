import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions, resolveSupportedLocale } from '@proj-airi/i18n'
import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createI18n } from 'vue-i18n'

function getLocale() {
  let language = 'en'
  // NOTICE: histoire doesn't have localStorage during collection, directly accessing it causes error.
  if ('localStorage' in globalThis && localStorage != null && 'getItem' in localStorage && typeof localStorage.getItem === 'function') {
    language = localStorage.getItem(accountStorageKey('settings/language')) || 'en'
  }

  if (!language) {
    // Fallback to browser language
    language = navigator.language || 'en'
  }

  return resolveSupportedLocale(language, Object.keys(messages!))
}

export const i18n = createI18n({
  legacy: false,
  locale: getLocale(),
  messages,
  ...createFallbackOptions(console.warn),
})
