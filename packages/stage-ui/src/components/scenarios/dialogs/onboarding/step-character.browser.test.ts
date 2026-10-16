import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import StepCharacter from './step-character.vue'

import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProviderConfigStore } from '../../../../stores/providers/config'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const generatedFields = {
  description: 'Your name is Mio. You are a cheerful classmate.',
  personality: 'Cheerful and curious.',
  scenario: 'You chat after class.',
  greeting: 'Hey! You made it!',
}

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia> }> = []

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

/** Creates stores with a configured chat model, as the model step leaves them. */
async function createContext() {
  const pinia = createPinia()
  let stores: { cards: ReturnType<typeof useAiriCardStore>, providerConfig: ReturnType<typeof useProviderConfigStore>, consciousness: ReturnType<typeof useConsciousnessStore> } | undefined
  const app = createApp({
    setup() {
      stores = { cards: useAiriCardStore(), providerConfig: useProviderConfigStore(), consciousness: useConsciousnessStore() }
      return () => null
    },
  })
  app.use(createTestI18n()).use(pinia).mount(document.createElement('div'))
  if (!stores)
    throw new Error('Stores did not initialize')

  contexts.push({ app, pinia })
  await stores.providerConfig.ensureProvider('openai-compatible', 'openai-compatible', {})
  await stores.providerConfig.patchProviderConfig('openai-compatible', { apiKey: 'sk-test', baseUrl: 'https://gateway.example.test/v1/' })
  stores.consciousness.activeProvider = 'openai-compatible'
  stores.consciousness.activeModel = 'grok-4.6'
  await stores.cards.initialize()
  return { pinia, ...stores }
}

function stubChatReply(reply: () => Response) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions'))
      return reply()
    return Response.json({ object: 'list', data: [{ id: 'grok-4.6' }] })
  }))
}

function streamOf(text: string) {
  const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.app.unmount()
    disposePinia(context.pinia)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('creates and activates a generated card from the name and the chosen preset', async () => {
  stubChatReply(() => streamOf(JSON.stringify(generatedFields)))
  const context = await createContext()
  const onNext = vi.fn()
  const screen = await render(StepCharacter, {
    props: { onNext, onPrevious: () => {} },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await page.getByPlaceholder('For example, Mio').fill('Mio')
  await screen.getByRole('button', { name: 'Lively' }).click()
  await expect.element(page.getByPlaceholder('For example, a gentle senior who teases you a little')).toHaveValue('A cheerful and energetic friend who loves to chat and joke.')
  await screen.getByRole('button', { name: 'Create character' }).click()

  await expect.poll(() => onNext).toHaveBeenCalledOnce()
  const card = context.cards.activeCard
  expect(context.cards.activeCardId).not.toBe('default')
  expect(card?.name).toBe('Mio')
  expect(card?.description).toBe(generatedFields.description)
  expect(card?.personality).toBe(generatedFields.personality)
  expect(card?.scenario).toBe(generatedFields.scenario)
  expect(card?.greetings).toEqual([generatedFields.greeting])
  expect(card?.extensions.airi.generation).toEqual({ summary: 'A cheerful and energetic friend who loves to chat and joke.' })
})

it('uses the preset template when the model request fails', async () => {
  // Core retries 5xx statuses for up to 21 seconds. A 401 fails at once, so the fallback runs without the timeout.
  stubChatReply(() => new Response('invalid key', { status: 401 }))
  const context = await createContext()
  const onNext = vi.fn()
  const screen = await render(StepCharacter, {
    props: { onNext, onPrevious: () => {} },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await page.getByPlaceholder('For example, Mio').fill('Mio')
  await page.getByPlaceholder('For example, a gentle senior who teases you a little').fill('A sleepy cat who loves rain.')
  await screen.getByRole('button', { name: 'Create character' }).click()

  await expect.poll(() => onNext, { timeout: 10_000 }).toHaveBeenCalledOnce()
  const card = context.cards.activeCard
  expect(card?.name).toBe('Mio')
  expect(card?.description).toBe('Your name is Mio. A sleepy cat who loves rain.')
  // The user chose no preset, so the gentle template applies.
  expect(card?.personality).toBe('You are gentle, patient, and warm. You listen first and answer with care. You speak softly and use simple words. You encourage the user and never mock them.')
  expect(card?.greetings).toEqual([])
})

it('keeps the default card when the user skips the step', async () => {
  stubChatReply(() => streamOf(JSON.stringify(generatedFields)))
  const context = await createContext()
  const onNext = vi.fn()
  const screen = await render(StepCharacter, {
    props: { onNext, onPrevious: () => {} },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await expect.element(screen.getByRole('button', { name: 'Create character' })).toBeDisabled()
  await screen.getByRole('button', { name: 'Skip and use the default character' }).click()

  await expect.poll(() => onNext).toHaveBeenCalledOnce()
  expect(context.cards.activeCardId).toBe('default')
  expect([...context.cards.cards.keys()]).toEqual(['default'])
})
