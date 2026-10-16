import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { useCharacterStateStore } from '../character/state'
import { useChatSessionStore } from '../chat/session-store'
import { useDisplayModelsStore } from '../display-models'
import { useAiriCardStore } from '../modules/airi-card'
import { useArtistryStore } from '../modules/artistry'
import { useConsciousnessStore } from '../modules/consciousness'
import { useSpeechStore } from '../modules/speech'
import { useVisionStore } from '../modules/vision'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useCharacterMemoryStore } from './memory-store'

const extractionReply = {
  coreBlocks: { 'user-profile': 'The user is Ren.' },
  episodes: [{ text: '用户的生日是 5 月 3 日。', factKey: 'user.birthday', importance: 0.9, keywords: ['生日'], occurredAt: null, annualDate: { month: 5, day: 3 }, replaces: [] }],
  affectionDelta: 4,
}

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia> }> = []

function streamOf(text: string) {
  const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

async function createContext() {
  const pinia = createPinia()
  let stores: {
    memory: ReturnType<typeof useCharacterMemoryStore>
    sessions: ReturnType<typeof useChatSessionStore>
    state: ReturnType<typeof useCharacterStateStore>
  } | undefined
  const app = createApp({
    setup() {
      // These stores call `useI18n` and must exist before the card store first activates.
      useProviderStore()
      useConsciousnessStore()
      useVisionStore()
      useSpeechStore()
      useArtistryStore()
      useSettingsStageModel()
      useDisplayModelsStore()
      useAiriCardStore()
      stores = { memory: useCharacterMemoryStore(), sessions: useChatSessionStore(), state: useCharacterStateStore() }
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
  return stores
}

/** Session A, where the user tells the character a birthday. */
async function saveSessionA(sessions: ReturnType<typeof useChatSessionStore>) {
  const now = Date.now()
  const meta = { sessionId: 'session-a', userId: 'local', characterId: 'default', createdAt: now, updatedAt: now }
  sessions.sessionMetas = { 'session-a': meta }
  await chatSessionsRepo.saveSession('session-a', {
    meta,
    messages: [
      { role: 'system', content: 'system prompt', id: 'system', createdAt: now - 2000 },
      { role: 'user', content: '我的生日是 5 月 3 日。', id: 'u1', createdAt: now - 1000 },
      { role: 'assistant', content: '我记住啦！', slices: [], tool_results: [], id: 'a1', createdAt: now - 500 },
    ],
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await useCharacterMemoryStore(context.pinia).stop()
    context.app.unmount()
    disposePinia(context.pinia)
  }
  await characterMemoryRepo.clearAll()
  await chatSessionsRepo.deleteSession('session-a')
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('recalls a birthday from session A in a request of session B without an embedding model', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      requests.push(String(init?.body ?? ''))
      return streamOf(JSON.stringify(extractionReply))
    }
    // The endpoint lists no embedding model, so recall must work with keywords only.
    return Response.json({ object: 'list', data: [{ id: 'chat-model' }] })
  }))
  const { memory, sessions, state } = await createContext()
  await saveSessionA(sessions)

  await memory.start()
  await expect.poll(async () => (await characterMemoryRepo.get('default'))?.episodes.length, { timeout: 10_000 }).toBe(1)

  const context = await memory.recallContext('default', '你还记得我的生日吗？', { newSession: true })
  expect(context).toContain('用户的生日是 5 月 3 日。')
  expect(context).toContain('About the user: The user is Ren.')
  expect(requests).toHaveLength(1)
  await expect.poll(() => state.affections.default?.points).toBe(4)
})

it('extracts each message once, so a second scan sends no request', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      requests.push(String(init?.body ?? ''))
      return streamOf(JSON.stringify(extractionReply))
    }
    return Response.json({ object: 'list', data: [] })
  }))
  const { memory, sessions } = await createContext()
  await saveSessionA(sessions)

  await memory.start()
  await expect.poll(async () => (await characterMemoryRepo.get('default'))?.episodes.length, { timeout: 10_000 }).toBe(1)
  await memory.extractNow('default')
  await new Promise(resolve => setTimeout(resolve, 200))

  expect(requests).toHaveLength(1)
  expect((await characterMemoryRepo.get('default'))?.episodes).toHaveLength(1)
})

it('keeps chat working when extraction fails, and reports nothing to recall', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions'))
      return new Response('invalid key', { status: 401 })
    return Response.json({ object: 'list', data: [] })
  }))
  const { memory, sessions } = await createContext()
  await saveSessionA(sessions)

  await memory.start()
  await expect.poll(() => memory.statuses.default?.state, { timeout: 10_000 }).toBe('working')

  expect(await memory.recallContext('default', '生日', { newSession: false })).toBe('')
})

it('does not write memory back when all data is deleted during an extraction', async () => {
  const reply = Promise.withResolvers<Response>()
  let requested = false
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      requested = true
      return reply.promise
    }
    return Response.json({ object: 'list', data: [] })
  }))
  const { memory, sessions } = await createContext()
  await saveSessionA(sessions)

  void memory.start()
  await expect.poll(() => requested, { timeout: 10_000 }).toBe(true)
  await memory.clearAll()
  // The model answers after the deletion.
  reply.resolve(streamOf(JSON.stringify(extractionReply)))
  await new Promise(resolve => setTimeout(resolve, 300))

  expect(await characterMemoryRepo.get('default')).toBeNull()
})

it('applies affection that a crash left after the memory commit', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ object: 'list', data: [] })))
  const { memory, state } = await createContext()
  // The memory commit holds the event, and the character state never received it.
  await characterMemoryRepo.update('default', current => ({ ...current, pendingAffectionEvents: [{ batchId: 'batch-before-crash', delta: 5 }] }))

  await memory.start()

  await expect.poll(() => state.affections.default?.points).toBe(5)
  expect((await characterMemoryRepo.get('default'))?.pendingAffectionEvents).toEqual([])
  // A second replay of the same batch adds nothing.
  await state.applyAffectionDelta('default', 'batch-before-crash', 5)
  expect(state.affections.default?.points).toBe(5)
})

it('leaves out an entry that the user deleted while recall waited for the embedding request', async () => {
  const vectorVersion = 'openai-compatible|https://gateway.example.test/v1/|BAAI/bge-m3'
  const queryEmbedding = Promise.withResolvers<Response>()
  let embeddingCalls = 0
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/embeddings')) {
      embeddingCalls++
      // The first call is the detection probe. The second one embeds the query and waits.
      return embeddingCalls === 1
        ? Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 0] }], model: 'BAAI/bge-m3', usage: { prompt_tokens: 1, total_tokens: 1 } })
        : queryEmbedding.promise
    }
    return Response.json({ object: 'list', data: [{ id: 'chat-model' }, { id: 'BAAI/bge-m3' }] })
  }))
  const { memory } = await createContext()
  const at = Date.now()
  await characterMemoryRepo.update('default', current => ({
    ...current,
    revision: current.revision + 1,
    episodes: [
      { id: 'birthday', text: '用户的生日是 5 月 3 日。', importance: 0.9, keywords: ['生日'], createdAt: at, sourceMessageIds: [], extractionBatchId: 'b1' },
      { id: 'secret', text: '用户的生日愿望是去北海道。', importance: 0.9, keywords: ['生日'], createdAt: at, sourceMessageIds: [], extractionBatchId: 'b1' },
    ],
  }))
  await characterMemoryRepo.putVectors('default', vectorVersion, { birthday: [1, 0], secret: [1, 0] })

  const recall = memory.recallContext('default', '生日', { newSession: false })
  await expect.poll(() => embeddingCalls, { timeout: 10_000 }).toBe(2)
  await memory.deleteEpisode('default', 'secret')
  queryEmbedding.resolve(Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [1, 0] }], model: 'BAAI/bge-m3', usage: { prompt_tokens: 1, total_tokens: 1 } }))

  const context = await recall
  expect(context).toContain('用户的生日是 5 月 3 日。')
  expect(context).not.toContain('北海道')
})

it('finds sessions of the persisted index after a restart', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      requests.push(String(init?.body ?? ''))
      return streamOf(JSON.stringify(extractionReply))
    }
    return Response.json({ object: 'list', data: [] })
  }))
  const { memory, sessions } = await createContext()
  // A restart: the session and its index are on disk, and the store has not loaded them.
  await saveSessionA(sessions)
  // The store holds a reactive proxy, and IndexedDB stores only plain data.
  const meta = JSON.parse(JSON.stringify(sessions.sessionMetas['session-a']))
  await chatSessionsRepo.saveIndex({ userId: 'local', characters: { default: { activeSessionId: 'session-a', sessions: { 'session-a': meta } } } })
  sessions.sessionMetas = {}

  await memory.start()

  await expect.poll(async () => (await characterMemoryRepo.get('default'))?.episodes.length, { timeout: 10_000 }).toBe(1)
  expect(requests).toHaveLength(1)
})
