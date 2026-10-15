import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { registerAuthorizationHandler } from '@proj-airi/stage-ui/libs/auth'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import ProvidersCatalogPage from './providers.vue'

import 'virtual:uno.css'

describe('v2 providers catalog availability (Issue #2559)', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    // The settings pages can trigger a sign-in request through the auth store.
    // The real app runtime registers this handler; the stub keeps the harness
    // from rejecting an unrelated OIDC flow while the catalog is under test.
    registerAuthorizationHandler(async () => {})
  })

  afterEach(() => {
    disposePinia(pinia)
    localStorage.clear()
  })

  async function renderCatalog() {
    await page.viewport(1280, 900)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    return await render(ProvidersCatalogPage, {
      global: {
        plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        directives: { autoAnimate: {} },
      },
    })
  }

  // ROOT CAUSE:
  //
  // The v2 add menu mapped raw listProviders() directly, so surface-gated
  // definitions (for example NVIDIA) appeared even though the module pickers
  // hide them again via the availability-filtered provider store.
  //
  // We fixed this by sourcing the menu from availableProvidersMetadata, the
  // same seam the v1 catalog already uses.
  // https://github.com/moeru-ai/airi/issues/2559
  it('hides surface-gated providers from the add menu (Issue #2559)', async () => {
    const screen = await renderCatalog()

    await screen.getByLabelText('Add Custom Provider').click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await expect.element(menu.getByText('Custom Provider (Chat)', { exact: true })).toBeVisible()
    expect((await menu.getByText('NVIDIA NIM', { exact: true }).all())).toHaveLength(0)
  })

  // https://github.com/moeru-ai/airi/issues/2559
  it('offers only custom endpoints in the add menu', async () => {
    const screen = await renderCatalog()

    await screen.getByLabelText('Add Custom Provider').click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await expect.element(menu.getByText('Custom Provider (Chat)', { exact: true })).toBeVisible()
    await expect.element(menu.getByText('Custom Provider (Speech)', { exact: true })).toBeVisible()
    await expect.element(menu.getByText('Custom Provider (Transcription)', { exact: true })).toBeVisible()
    for (const name of ['OpenAI', 'OpenAI Compatible', 'Ollama', 'DeepSeek', 'Groq']) {
      await expect.element(menu.getByText(name, { exact: true })).not.toBeInTheDocument()
    }
    await menu.getByText('Custom Provider (Chat)', { exact: true }).click()
    await expect.poll(() => Object.values(useProviderConfigStore(pinia).providers).map(provider => provider.config.baseUrl)).toEqual([''])
  })
})
