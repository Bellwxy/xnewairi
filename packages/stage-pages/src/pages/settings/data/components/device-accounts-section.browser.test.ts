import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import DeviceAccountsSection from './device-accounts-section.vue'

import 'virtual:uno.css'

// The shared setup file fixes this page in the `local` account.
describe('accounts on this device in Data settings', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    disposePinia(pinia)
    localStorage.clear()
  })

  async function renderSection() {
    const statuses: unknown[] = []
    const screen = render(DeviceAccountsSection, {
      props: { onStatus: (payload: unknown) => statuses.push(payload) },
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })
    return { screen, statuses }
  }

  it('deletes another account after confirmation and keeps the current account', async () => {
    localStorage.setItem('account/local/airi-cards', 'mine')
    localStorage.setItem('account/alice/airi-cards', 'alice')
    const { screen, statuses } = await renderSection()

    await expect.element(screen.getByText('alice')).toBeVisible()
    await expect.element(screen.getByText('Signed-out data')).toBeVisible()
    await expect.element(screen.getByText('Current account')).toBeVisible()
    // Only the other account has a delete action.
    expect(screen.getByRole('button', { name: 'Delete data' }).elements()).toHaveLength(1)

    await screen.getByRole('button', { name: 'Delete data' }).click()
    await screen.getByRole('button', { name: 'Yes' }).click()

    await expect.poll(() => localStorage.getItem('account/alice/airi-cards')).toBeNull()
    expect(localStorage.getItem('account/local/airi-cards')).toBe('mine')
    await expect.element(screen.getByText('No other account keeps data on this device.')).toBeVisible()
    expect(statuses).toEqual([{ message: 'Account data deleted from this device.', tone: 'success' }])
  })
})
