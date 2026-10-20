import type { GeneratedCharacterFields } from '@proj-airi/stage-ui/services/character-card-generation'

import en from '@proj-airi/i18n/locales/en'

import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { toRaw } from 'vue'
import { createI18n } from 'vue-i18n'

import CardRegeneration from './card-regeneration.vue'

import 'virtual:uno.css'

// The chat model is an external boundary. Each test decides what it returns.
const generate = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<GeneratedCharacterFields>>())
vi.mock('@proj-airi/stage-ui/composables/use-character-card-generation', () => ({
  useCharacterCardGeneration: () => ({ generate }),
}))

const generated: GeneratedCharacterFields = {
  description: 'Your name is Luna. You are a calm night owl.',
  personality: 'Calm and patient.',
  scenario: 'You talk late at night.',
  greeting: 'Still awake?',
}

describe('card regeneration', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    generate.mockReset()
  })

  afterEach(() => {
    cleanup()
    disposePinia(pinia)
    localStorage.clear()
  })

  // The store calls `useI18n()` at its own setup, so the panel mounts first on a placeholder id.
  async function renderPanel() {
    const screen = await render(CardRegeneration, {
      props: { cardId: 'placeholder' },
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })
    const store = useAiriCardStore(pinia)
    store.moduleDefaults = {
      consciousness: { provider: 'gateway', model: 'chat-model' },
      speech: { provider: 'speech-noop', model: '', voice_id: '' },
      displayModelId: '',
    }
    const cardId = await store.addCard({
      name: 'Luna',
      version: '1.0.0',
      description: 'Old description.',
      personality: 'Old personality.',
      scenario: 'Old scenario.',
      greetings: ['Old greeting.', 'Alternate greeting.'],
      systemPrompt: 'Kept prompt.',
    }, 'scratch')
    await screen.rerender({ cardId })
    return { screen, store, cardId }
  }

  async function regenerate(screen: Awaited<ReturnType<typeof renderPanel>>['screen']) {
    await screen.getByPlaceholder('For example, a gentle senior who teases a little.').fill('A calm night owl.')
    await screen.getByRole('button', { name: 'Regenerate' }).click()
  }

  it('sends the summary to the chat model of the card', async () => {
    generate.mockResolvedValue(generated)
    const { screen } = await renderPanel()

    await regenerate(screen)

    await expect.element(screen.getByText(generated.personality)).toBeVisible()
    expect(generate).toHaveBeenCalledWith(
      { provider: 'gateway', model: 'chat-model' },
      { name: 'Luna', summary: 'A calm night owl.', language: 'en' },
      expect.any(AbortSignal),
    )
  })

  it('keeps the card when the user keeps the current text', async () => {
    generate.mockResolvedValue(generated)
    const { screen, store, cardId } = await renderPanel()
    const before = structuredClone(toRaw(store.getCard(cardId)))

    await regenerate(screen)
    await screen.getByRole('button', { name: 'Keep current' }).click()

    await expect.element(screen.getByText(generated.personality)).not.toBeInTheDocument()
    expect(structuredClone(toRaw(store.getCard(cardId)))).toEqual(before)
  })

  it('replaces only the generated fields of the latest card', async () => {
    generate.mockResolvedValue(generated)
    const { screen, store, cardId } = await renderPanel()

    await regenerate(screen)
    // Another surface renames the card while the preview waits. Replacing must keep that change.
    await store.updateCard(cardId, { ...structuredClone(toRaw(store.getCard(cardId)!)), name: 'Luna Prime' })
    await screen.getByRole('button', { name: 'Replace' }).click()

    const card = store.getCard(cardId)!
    expect(card.name).toBe('Luna Prime')
    expect(card.systemPrompt).toBe('Kept prompt.')
    expect(card.description).toBe(generated.description)
    expect(card.personality).toBe(generated.personality)
    expect(card.scenario).toBe(generated.scenario)
    expect(card.greetings).toEqual([generated.greeting, 'Alternate greeting.'])
    expect(card.extensions.airi.generation).toEqual({ summary: 'A calm night owl.' })
  })

  it('shows the error and keeps the card when generation fails', async () => {
    generate.mockRejectedValue(new Error('Character generation timed out after 20000ms'))
    const { screen, store, cardId } = await renderPanel()
    const before = structuredClone(toRaw(store.getCard(cardId)))

    await regenerate(screen)

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Character generation timed out after 20000ms')
    expect(structuredClone(toRaw(store.getCard(cardId)))).toEqual(before)
  })
})
