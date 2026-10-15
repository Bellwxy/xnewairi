import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import StepWelcome from './step-welcome.vue'

afterEach(() => vi.unstubAllEnvs())

describe('custom-provider onboarding', () => {
  it('starts provider setup without sign-in or pricing links', async () => {
    vi.stubEnv('VITE_DISABLE_CUSTOM_PROVIDERS', 'true')
    const onNext = vi.fn()
    const screen = render(StepWelcome, {
      props: { onNext },
      global: {
        directives: { motion: {} },
        plugins: [
          createPinia(),
          createI18n({ legacy: false, locale: 'en', messages: { en } }),
        ],
      },
    })

    await screen.getByRole('button', { name: 'Setup with your provider' }).click()

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Sign in')
    expect(document.body.textContent).not.toContain('Pricing')
    expect(document.querySelector('a[href="/settings/flux"]')).toBeNull()
  })
})
