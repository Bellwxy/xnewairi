import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import ProviderDirectory from './index.vue'

import 'virtual:uno.css'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
})

afterEach(() => {
  disposePinia(pinia)
  localStorage.clear()
})

it('shows only custom endpoints in every provider category', async () => {
  await page.viewport(1100, 900)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings/providers', component: ProviderDirectory }],
  })
  await router.push('/settings/providers')
  const screen = await render(ProviderDirectory, {
    global: { plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })

  const customLink = screen.getByRole('link', { name: /Custom Provider/ })
  await expect.element(customLink).toHaveAttribute('href', '/settings/providers/chat/openai-compatible')
  for (const name of ['OpenAI', 'Ollama', 'Anthropic', 'DeepSeek', 'OpenAI Compatible', 'ComfyUI', 'Replicate', 'Nano Banana']) {
    await expect.element(screen.getByText(name, { exact: true })).not.toBeInTheDocument()
  }
  await expect.element(screen.getByText('Pricing', { exact: true })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Artistry', exact: true })).not.toBeInTheDocument()
  // The gateway chat model reads images, so the directory has no vision category.
  await expect.element(screen.getByRole('button', { name: 'Vision', exact: true })).not.toBeInTheDocument()

  for (const [category, path] of [
    ['Speech', '/settings/providers/speech/openai-compatible-audio-speech'],
    ['Transcription', '/settings/providers/transcription/openai-compatible-audio-transcription'],
    ['Chat', '/settings/providers/chat/openai-compatible'],
  ]) {
    await screen.getByRole('button', { name: category, exact: true }).click()
    await expect.element(customLink).toHaveAttribute('href', path)
  }
})
