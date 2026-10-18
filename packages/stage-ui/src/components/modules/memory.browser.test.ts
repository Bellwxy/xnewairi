import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import MemorySettings from './memory.vue'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { useDisplayModelsStore } from '../../stores/display-models'
import { commitExtraction, createMemoryDocument, editCoreBlock } from '../../stores/memory/memory-document'
import { useMemorySettingsStore } from '../../stores/memory/memory-settings'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useArtistryStore } from '../../stores/modules/artistry'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { useSpeechStore } from '../../stores/modules/speech'
import { useProviderStore } from '../../stores/providers/provider'
import { useSettingsStageModel } from '../../stores/settings/stage-model'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia> }> = []

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

async function createContext() {
  const pinia = createPinia()
  const app = createApp({
    setup() {
      // These stores call `useI18n` and must exist before the card store first activates.
      useProviderStore()
      useConsciousnessStore()
      useSpeechStore()
      useArtistryStore()
      useSettingsStageModel()
      useDisplayModelsStore()
      useAiriCardStore()
      return () => null
    },
  })
  app.use(createTestI18n()).use(pinia).mount(document.createElement('div'))
  contexts.push({ app, pinia })
  await useAiriCardStore(pinia).initialize()
  return pinia
}

async function seedMemory() {
  const at = Date.now()
  const document = commitExtraction(editCoreBlock(createMemoryDocument('default', at), 'user-profile', 'The user is called Ren.', at - 1), {
    batchId: 'batch-1',
    generation: 0,
    sessionId: 'session-a',
    messageIds: ['m1'],
    readAt: at,
    coreBlocks: {},
    candidateIds: [],
    affectionDelta: 0,
    episodes: [
      { id: 'birthday', text: 'The user was born on 3 May.', importance: 0.9, keywords: [], replaces: [] },
      { id: 'tea', text: 'The user likes oolong tea.', importance: 0.4, keywords: [], replaces: [] },
    ],
  }, at).document
  await characterMemoryRepo.update('default', () => document)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.app.unmount()
    disposePinia(context.pinia)
  }
  await characterMemoryRepo.clearAll()
  localStorage.clear()
})

it('shows what the character remembers and deletes one entry', async () => {
  const pinia = await createContext()
  await seedMemory()
  await page.viewport(560, 900)
  render(MemorySettings, { global: { plugins: [pinia, createTestI18n()] } })

  await expect.element(page.getByText('The user is called Ren.')).toBeInTheDocument()
  await expect.element(page.getByText('The user was born on 3 May.')).toBeInTheDocument()
  await expect.element(page.getByText('Memory is up to date.')).toBeInTheDocument()

  await page.getByRole('button', { name: 'Delete' }).last().click()

  await expect.poll(async () => (await characterMemoryRepo.get('default'))?.episodes.map(episode => episode.id)).toHaveLength(1)
  await expect.element(page.getByText('The user likes oolong tea.')).not.toBeInTheDocument()
})

it('hides everything but the switch when memory is off', async () => {
  const pinia = await createContext()
  localStorage.clear()
  render(MemorySettings, { global: { plugins: [pinia, createTestI18n()] } })

  await page.getByRole('switch').first().click()

  await expect.element(page.getByText('What the character remembers')).not.toBeInTheDocument()
})

it('saves an extraction model override for the chat provider without a provider field', async () => {
  // The default card inherits the chat provider that the runtime has when the card store starts.
  localStorage.setItem(accountStorageKey('settings/consciousness/active-provider'), 'openai-compatible')
  const pinia = await createContext()
  render(MemorySettings, { global: { plugins: [pinia, createTestI18n()] } })

  await page.getByText('Advanced').click()
  await expect.element(page.getByText('Provider', { exact: true })).not.toBeInTheDocument()
  await page.getByRole('textbox', { name: 'Model' }).fill('gateway-small')

  await expect.poll(() => useMemorySettingsStore(pinia).extractionOverride).toEqual({ provider: 'openai-compatible', model: 'gateway-small' })
})
