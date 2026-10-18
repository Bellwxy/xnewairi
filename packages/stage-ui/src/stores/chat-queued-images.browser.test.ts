import en from '@proj-airi/i18n/locales/en'

import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { useChatStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useModsServerChannelStore } from './mods/api/channel-server'
import { useAiriCardStore } from './modules/airi-card'
import { useConsciousnessStore } from './modules/consciousness'

const gatewayUrl = 'https://gateway.example.test/v1/'
const pinias: ReturnType<typeof createPinia>[] = []

function character(model: string) {
  return {
    name: model,
    version: '1.0',
    extensions: {
      airi: {
        agents: {},
        modules: {
          consciousness: { provider: 'openai-compatible', model },
          speech: { provider: 'speech-noop', model: '', voice_id: '' },
        },
      },
    },
  }
}

/** The card store and the provider store read storage when they start, so the test writes it first. */
function storeCharacters() {
  localStorage.setItem(accountStorageKey('airi-cards'), JSON.stringify([
    ['default', character('default-model')],
    ['alice', character('alice-model')],
    ['bob', character('bob-model')],
  ]))
  localStorage.setItem(accountStorageKey('airi-card-active-id'), JSON.stringify('alice'))
  localStorage.setItem(accountStorageKey('settings/providers/configured'), JSON.stringify({
    'openai-compatible': {
      id: 'openai-compatible',
      definitionId: 'openai-compatible',
      config: { apiKey: 'gateway-key', baseUrl: gatewayUrl },
      status: 'configured',
      configuredBy: 'user',
    },
  }))
}

/** One streamed reply of the gateway in the Chat Completions format. */
function streamedReply() {
  const chunks = [
    { id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Seen.' }, finish_reason: null }] },
    { id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => {
  for (const pinia of pinias.splice(0)) {
    useModsServerChannelStore(pinia).dispose()
    useChatStore(pinia).dispose()
    disposePinia(pinia)
  }
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('sends a queued image to the chat model of the session character after the active card changes', async () => {
  storeCharacters()
  const firstReply = Promise.withResolvers<void>()
  const chatRequests: Array<{ model: string, body: string }> = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(`${gatewayUrl}chat/completions`))
      return Response.json({ object: 'list', data: [] })

    const body = String(init?.body)
    chatRequests.push({ model: JSON.parse(body).model, body })
    if (chatRequests.length === 1)
      await firstReply.promise
    return streamedReply()
  }))

  const pinia = createPinia()
  pinias.push(pinia)
  render(defineComponent({
    setup() {
      useChatStore()
      return () => h('div')
    },
  }), { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  const chat = useChatStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const cards = useAiriCardStore(pinia)
  await cards.initialize()
  await sessions.initialize()
  const sessionId = await sessions.createSession('alice')

  const first = chat.send({ sessionId, text: 'Hello' })
  await vi.waitFor(() => expect(chatRequests).toHaveLength(1))
  const queued = chat.send({
    sessionId,
    text: 'What is in this picture?',
    attachments: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
  })
  await vi.waitFor(() => expect(chat.pendingQueuedSendCount).toBe(1))

  // Another window selects a different character while the image waits in the queue.
  await cards.activateCard('bob')
  expect(useConsciousnessStore(pinia).activeModel).toBe('bob-model')
  firstReply.resolve()
  await Promise.all([first, queued])

  const imageRequest = chatRequests.find(request => request.body.includes('data:image/png;base64,aW1hZ2U='))
  expect(chatRequests).toHaveLength(2)
  expect(imageRequest?.model).toBe('alice-model')
  expect(chatRequests.some(request => request.model === 'bob-model')).toBe(false)
})
