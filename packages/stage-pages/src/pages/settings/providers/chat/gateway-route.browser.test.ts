import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import ChatProviderRoute from './[providerId].vue'

import 'virtual:uno.css'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  // Validation of the gateway view reaches the network. No test expects a real endpoint.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ object: 'list', data: [] })))
})

afterEach(() => {
  disposePinia(pinia)
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function openRoute(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/providers/chat/:providerId', component: ChatProviderRoute },
      { path: '/settings/modules/consciousness', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  const screen = await render(ChatProviderRoute, {
    global: { plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  return { router, screen }
}

it.each(['openai', 'deepseek'])('returns the %s settings route to Consciousness settings', async (providerId) => {
  const { router } = await openRoute(`/settings/providers/chat/${providerId}`)

  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings/modules/consciousness'))
  await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
})

it('opens the key settings of the gateway provider', async () => {
  const { router } = await openRoute('/settings/providers/chat/openai-compatible')

  await expect.element(page.getByRole('textbox').first()).toBeInTheDocument()
  expect(router.currentRoute.value.path).toBe('/settings/providers/chat/openai-compatible')
})
