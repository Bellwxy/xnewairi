import messages from '@proj-airi/i18n/locales'

import { CURRENT_ACCOUNT_STORAGE_KEY } from '@proj-airi/stage-shared/account-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import AccountSwitchDialog from './account-switch-dialog.vue'

import { ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS, onBeforeAccountSwitch, switchAccount, useAccountSwitchConfirmation } from '../../../../services/account-switch'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

let pendingSwitch: Promise<void> | undefined
let removeDrain: (() => void) | undefined

afterEach(async () => {
  useAccountSwitchConfirmation().force()
  await pendingSwitch
  pendingSwitch = undefined
  removeDrain?.()
  removeDrain = undefined
  vi.useRealTimers()
  cleanup()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

async function openDialog(locale: 'en' | 'zh-Hans' = 'en') {
  const write = Promise.withResolvers<void>()
  removeDrain = onBeforeAccountSwitch(() => write.promise)
  const enterAccount = vi.fn()
  const i18n = createI18n({ legacy: false, locale, messages })
  expect(i18n.global.te('settings.pages.account.switch.description', locale)).toBe(true)
  const screen = await render(AccountSwitchDialog, { global: { plugins: [i18n] } })
  localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, 'local')

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  pendingSwitch = switchAccount('bob', enterAccount)
  await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_DRAIN_TIMEOUT_MS)
  vi.useRealTimers()
  await expect.element(screen.getByRole('dialog')).toBeVisible()

  return { screen, write, enterAccount, t: i18n.global.t }
}

describe('account switch confirmation', () => {
  it('waits without changing the pointer and closes automatically when the writes finish', async () => {
    const { screen, write, enterAccount, t } = await openDialog()
    const wait = screen.getByRole('button', { name: t('settings.pages.account.switch.wait') })

    await expect.element(wait).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await wait.click()

    await expect.element(screen.getByRole('status')).toHaveTextContent(t('settings.pages.account.switch.waiting'))
    await expect.element(wait).toBeDisabled()
    expect(localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)).toBe('local')
    expect(enterAccount).not.toHaveBeenCalled()

    write.resolve()
    await pendingSwitch

    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)).toBe('bob')
    expect(enterAccount).toHaveBeenCalledExactlyOnceWith('bob')
  })

  it('warns about data loss and permits force after the user first chooses to wait', async () => {
    const { screen, enterAccount, t } = await openDialog('zh-Hans')

    await expect.element(screen.getByText(t('settings.pages.account.switch.description'))).toBeVisible()
    await screen.getByRole('button', { name: t('settings.pages.account.switch.wait') }).click()
    await screen.getByRole('button', { name: t('settings.pages.account.switch.force') }).click()
    await pendingSwitch

    expect(enterAccount).toHaveBeenCalledExactlyOnceWith('bob')
    expect(localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)).toBe('bob')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    { width: 320, height: 740, locale: 'en' as const, dark: false },
    { width: 390, height: 844, locale: 'zh-Hans' as const, dark: true },
    { width: 1280, height: 900, locale: 'en' as const, dark: true },
  ])('keeps the dialog and actions inside $width x $height in $locale', async ({ width, height, locale, dark }) => {
    await page.viewport(width, height)
    document.documentElement.classList.toggle('dark', dark)
    const { screen, t } = await openDialog(locale)
    const dialog = screen.getByRole('dialog').element()

    await expect.poll(() => getComputedStyle(dialog).position).toBe('fixed')
    const bounds = dialog.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(height)
    expect(getComputedStyle(dialog).backgroundColor).toBe(dark ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)')

    for (const action of ['wait', 'force']) {
      const button = screen.getByRole('button', { name: t(`settings.pages.account.switch.${action}`) }).element()
      const buttonBounds = button.getBoundingClientRect()
      expect(buttonBounds.left).toBeGreaterThanOrEqual(bounds.left)
      expect(buttonBounds.right).toBeLessThanOrEqual(bounds.right)
      expect(buttonBounds.height).toBeGreaterThanOrEqual(44)
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
    }
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
  })
})
