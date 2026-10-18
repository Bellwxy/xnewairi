import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { useChatSessionStore } from '../chat/session-store'
import { useDisplayModelsStore } from '../display-models'
import { commitExtraction, createMemoryDocument } from '../memory/memory-document'
import { useAiriCardStore } from '../modules/airi-card'
import { useArtistryStore } from '../modules/artistry'
import { useConsciousnessStore } from '../modules/consciousness'
import { useSpeechStore } from '../modules/speech'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useCharacterOrchestratorStore } from './orchestrator'
import { useProactiveCareStore } from './proactive'

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia> }> = []

function streamOf(text: string) {
  const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

async function createContext() {
  const pinia = createPinia()
  let stores: { proactive: ReturnType<typeof useProactiveCareStore>, sessions: ReturnType<typeof useChatSessionStore> } | undefined
  const app = createApp({
    setup() {
      // These stores call `useI18n` and must exist before other stores first use them.
      useProviderStore()
      useConsciousnessStore()
      useSpeechStore()
      useArtistryStore()
      useSettingsStageModel()
      useDisplayModelsStore()
      useAiriCardStore()
      useCharacterOrchestratorStore()
      stores = { proactive: useProactiveCareStore(), sessions: useChatSessionStore() }
      return () => null
    },
  })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en } })).use(pinia).mount(document.createElement('div'))
  if (!stores)
    throw new Error('Stores did not initialize')
  contexts.push({ app, pinia })

  const providerConfig = useProviderConfigStore(pinia)
  await providerConfig.ensureProvider('openai-compatible', 'openai-compatible', {})
  await providerConfig.patchProviderConfig('openai-compatible', { apiKey: 'sk-test', baseUrl: 'https://gateway.example.test/v1/' })
  const consciousness = useConsciousnessStore(pinia)
  consciousness.activeProvider = 'openai-compatible'
  consciousness.activeModel = 'chat-model'
  await useAiriCardStore(pinia).initialize()

  const now = Date.now()
  stores.sessions.sessionMetas = { 'session-a': { sessionId: 'session-a', userId: 'local', characterId: 'default', createdAt: now, updatedAt: now } }
  stores.sessions.activeSessionId = 'session-a'
  stores.sessions.setSessionMessages('session-a', [])
  return stores
}

function at(day: number, hour: number, minute = 0) {
  return new Date(2026, 9, day, hour, minute).getTime()
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions'))
      return streamOf('<|ACT {"emotion":"happy"}|> Good morning, Ren!')
    return Response.json({ object: 'list', data: [{ id: 'chat-model' }] })
  }))
})

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    useProactiveCareStore(context.pinia).stop()
    context.app.unmount()
    disposePinia(context.pinia)
  }
  await characterMemoryRepo.clearAll()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('writes the morning greeting to the active session as a proactive message', async () => {
  const { proactive, sessions } = await createContext()

  await proactive.check(at(16, 8, 30))

  // The session store adds its system message first.
  const messages = sessions.getSessionMessages('session-a').filter(message => message.role === 'assistant')
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Good morning, Ren!', source: 'proactive' })
})

it('greets once and stays quiet at night', async () => {
  const { proactive, sessions } = await createContext()

  await proactive.check(at(16, 8, 30))
  await proactive.check(at(16, 8, 31))
  await proactive.check(at(17, 3, 0))

  expect(sessions.getSessionMessages('session-a').filter(message => message.role === 'assistant')).toHaveLength(1)
})

it('creates an anniversary routine from a remembered birthday and removes it with the memory', async () => {
  const { proactive } = await createContext()
  const document = commitExtraction(createMemoryDocument('default', Date.now()), {
    batchId: 'batch-1',
    generation: 0,
    sessionId: 'session-a',
    messageIds: ['m1'],
    readAt: Date.now(),
    coreBlocks: {},
    candidateIds: [],
    affectionDelta: 0,
    episodes: [{ id: 'birthday', text: 'The user was born on 3 May.', importance: 0.9, keywords: [], annualDate: { month: 5, day: 3 }, replaces: [] }],
  }, Date.now()).document
  await characterMemoryRepo.update('default', () => document)

  expect((await proactive.routinesFor('default')).find(routine => routine.kind === 'anniversary')?.schedule).toMatchObject({ type: 'yearly', month: 5, day: 3 })

  await characterMemoryRepo.update('default', current => ({ ...current, episodes: [] }))
  expect((await proactive.routinesFor('default')).some(routine => routine.kind === 'anniversary')).toBe(false)
})
