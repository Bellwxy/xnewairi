import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import CardEditor from './CardEditor.vue'

import 'virtual:uno.css'

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia> }> = []

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

async function createCardContext() {
  const pinia = createPinia()
  let cards: ReturnType<typeof useAiriCardStore> | undefined
  const app = createApp({
    setup() {
      // The card store creates these stores on its first activation. Some of them call `useI18n`,
      // which only works inside a component setup, so they are created here first.
      useProviderStore()
      useConsciousnessStore()
      useVisionStore()
      useSpeechStore()
      useArtistryStore()
      useSettingsStageModel()
      useDisplayModelsStore()
      cards = useAiriCardStore()
      return () => null
    },
  })
  app.use(createTestI18n()).use(pinia).mount(document.createElement('div'))
  if (!cards)
    throw new Error('The card store did not initialize')
  contexts.push({ app, pinia })

  await cards.initialize()
  const cardId = await cards.addCard({
    name: 'Mio',
    version: '1.0.0',
    personality: 'Calm.',
    scenario: 'A cafe.',
    extensions: {
      airi: {
        modules: {
          consciousness: { provider: '', model: '' },
          vision: { provider: '', model: '' },
          speech: { provider: '', model: '', voice_id: '' },
        },
        agents: {},
      },
    },
  }, 'scratch')
  return { pinia, cards, cardId }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.app.unmount()
    disposePinia(context.pinia)
  }
  localStorage.clear()
})

it('keeps a wake word that a tool wrote while the editor was open', async () => {
  const { pinia, cards, cardId } = await createCardContext()
  const screen = await render(CardEditor, {
    props: { cardId, initialSection: 'behavior' },
    global: { plugins: [pinia, PiniaColada, createTestI18n()] },
  })
  const personality = page.getByRole('textbox').nth(0)
  await expect.element(personality).toHaveValue('Calm.')

  const wakeWords = [{ text: 'mio', modelId: 'zh-kws', pronunciations: [['m', 'i', 'o']] }]
  const stored = cards.getCard(cardId)!
  await cards.updateCard(cardId, { ...stored, extensions: { ...stored.extensions, airi: { ...stored.extensions.airi, wakeWords } } })
  await personality.fill('Cheerful.')
  await screen.getByRole('button', { name: 'Save changes' }).first().click()

  await expect.poll(() => cards.getCard(cardId)?.personality).toBe('Cheerful.')
  expect(cards.getCard(cardId)?.extensions.airi.wakeWords).toEqual(wakeWords)
})

it('asks which version to keep when another source changed the same field', async () => {
  const { pinia, cards, cardId } = await createCardContext()
  const screen = await render(CardEditor, {
    props: { cardId, initialSection: 'behavior' },
    global: { plugins: [pinia, PiniaColada, createTestI18n()] },
  })
  const personality = page.getByRole('textbox').nth(0)
  await expect.element(personality).toHaveValue('Calm.')

  await cards.updateCard(cardId, { ...cards.getCard(cardId)!, personality: 'Shy.' })
  await personality.fill('Cheerful.')
  await screen.getByRole('button', { name: 'Save changes' }).first().click()

  await expect.element(page.getByText('This card changed while you edited it')).toBeInTheDocument()
  expect(cards.getCard(cardId)?.personality).toBe('Shy.')

  await page.getByRole('button', { name: 'Keep my edits' }).click()
  await expect.poll(() => cards.getCard(cardId)?.personality).toBe('Cheerful.')
})

it('blocks a new personality over 2000 characters', async () => {
  const { pinia, cards, cardId } = await createCardContext()
  const screen = await render(CardEditor, {
    props: { cardId, initialSection: 'behavior' },
    global: { plugins: [pinia, PiniaColada, createTestI18n()] },
  })
  const personality = page.getByRole('textbox').nth(0)
  await expect.element(personality).toHaveValue('Calm.')

  await personality.fill('a'.repeat(2001))
  await screen.getByRole('button', { name: 'Save changes' }).first().click()

  await expect.element(page.getByText('The personality is longer than 2000 characters. Shorten it before you save.').first()).toBeInTheDocument()
  expect(cards.getCard(cardId)?.personality).toBe('Calm.')
})

it('replaces only the draft when the user applies a preset', async () => {
  const { pinia, cards, cardId } = await createCardContext()
  const screen = await render(CardEditor, {
    props: { cardId, initialSection: 'behavior' },
    global: { plugins: [pinia, PiniaColada, createTestI18n()] },
  })
  const personality = page.getByRole('textbox').nth(0)
  await expect.element(personality).toHaveValue('Calm.')

  await screen.getByRole('button', { name: 'Lively' }).click()
  await screen.getByRole('button', { name: 'Replace' }).click()

  await expect.element(personality).toHaveValue('You are cheerful, curious, and full of energy. You like jokes and small surprises. You speak with feeling. You stay kind when you tease the user.')
  expect(cards.getCard(cardId)?.personality).toBe('Calm.')
})
