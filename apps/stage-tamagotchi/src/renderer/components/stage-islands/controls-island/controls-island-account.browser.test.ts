import en from '@proj-airi/i18n/locales/en'

import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ControlsIslandAuthButton from './controls-island-auth-button.vue'

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { ref } = await import('vue')
  return {
    useElectronEventaContext: () => ref({ on: vi.fn(() => vi.fn()) }),
    useElectronEventaInvoke: () => vi.fn(),
  }
})

it('shows account identity without a billing balance', async () => {
  const pinia = createPinia()
  const now = new Date()
  useAuthStore(pinia).$patch({
    user: { id: 'user', name: 'Custom user', email: 'user@example.test', emailVerified: true, createdAt: now, updatedAt: now },
    session: { id: 'session', userId: 'user', token: 'session-token', createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000) },
  })
  const screen = render(ControlsIslandAuthButton, {
    props: { active: true },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  try {
    await expect.element(screen.getByText('Custom user')).toBeVisible()
    expect(document.body.textContent).not.toContain('Flux')
    expect(document.querySelector('.i-solar\\:battery-charge-bold-duotone')).toBeNull()
  }
  finally {
    screen.unmount()
    disposePinia(pinia)
  }
})
