import type { ProviderTranslator } from '@proj-airi/provider-inference'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getDefinedProvider } from './registry'

import './index'

// The build injects the brand. This build fixes the gateway model.
vi.mock('@proj-airi/stage-shared/brand', async (importOriginal) => {
  const original = await importOriginal<typeof import('@proj-airi/stage-shared/brand')>()
  return { brand: { ...original.brand, inferenceModel: 'fixed-model' } }
})

const translate = ((key: string) => key) as ProviderTranslator
const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
  id: 'chat-1',
  object: 'chat.completion',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockClear()
  vi.unstubAllGlobals()
})

it('validates the gateway key with the fixed model and no model catalog request', async () => {
  const definition = getDefinedProvider('openai-compatible')
  if (!definition)
    throw new Error('The gateway definition is not registered.')
  const config = { apiKey: 'gateway-key', baseUrl: 'https://gateway.example.com/v1/' }
  const provider = await definition.createProvider(config)
  const validators = await Promise.all((definition.validators?.validateProvider ?? []).map(create => create({ t: translate })))

  const results = await Promise.all(validators.map(({ validator }) => validator(config, provider, definition.extraMethods ?? {}, { t: translate })))

  expect(results.every(result => result.valid)).toBe(true)
  const urls = fetchMock.mock.calls.map(([input]) => String(input))
  expect(urls).toEqual(['https://gateway.example.com/v1/chat/completions'])
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'fixed-model' })
})
