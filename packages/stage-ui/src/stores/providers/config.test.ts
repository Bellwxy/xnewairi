import type { InferenceServiceProvider } from '../../libs/providers/types'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useProviderConfigStore } from './config'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const { brandState } = vi.hoisted(() => ({
  // The build injects the brand. Each test sets the gateway that its build would contain.
  brandState: { inferenceBaseUrl: '' },
}))

vi.mock('@proj-airi/stage-shared/brand', () => ({ brand: brandState }))
vi.mock('../../libs/providers', () => ({
  getDefinedProvider: vi.fn((id: string) => ({ id, name: id })),
}))

const localProvider = {
  id: 'local-provider',
  definitionId: 'openai-compatible',
  config: { apiKey: 'sk-local' },
  status: 'unconfigured',
  configuredBy: 'user',
} satisfies InferenceServiceProvider

function installStore() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  setActivePinia(pinia)
  return useProviderConfigStore()
}

describe('provider config store', () => {
  beforeEach(() => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      localStorage: storage,
      removeEventListener: vi.fn(),
    })
    brandState.inferenceBaseUrl = ''
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('adds a local provider instance', async () => {
    const store = installStore()

    const added = await store.addProvider('openai-compatible', { apiKey: 'sk-new' })

    expect(added.definitionId).toBe('openai-compatible')
    expect(store.listedProviders[added.id]?.config).toEqual({ apiKey: 'sk-new' })
  })

  it('patches configuration through the owning provider record', async () => {
    const store = installStore()
    store.providers[localProvider.id] = {
      ...localProvider,
      config: { baseUrl: 'https://example.com/v1/' },
    }

    expect(await store.patchProviderConfig(localProvider.id, { apiKey: 'sk-test' })).toBe(true)
    expect(store.getProviderConfig(localProvider.id)).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1/',
    })
  })

  it('does not create an incomplete provider while patching configuration', async () => {
    const store = installStore()

    expect(await store.patchProviderConfig('missing-provider', { apiKey: 'sk-test' })).toBe(false)
    expect(store.getProvider('missing-provider')).toBeUndefined()
  })

  it('pins the brand gateway into every chat endpoint write', async () => {
    brandState.inferenceBaseUrl = 'https://gateway.customer.example/v1/'
    const store = installStore()

    store.ensureProvider('openai-compatible', 'openai-compatible', { apiKey: 'sk-key', baseUrl: 'https://other.example/v1/' })
    expect(store.getProviderConfig('openai-compatible')?.baseUrl).toBe('https://gateway.customer.example/v1/')

    await store.patchProviderConfig('openai-compatible', { baseUrl: 'https://other.example/v1/' })
    expect(store.getProviderConfig('openai-compatible')?.baseUrl).toBe('https://gateway.customer.example/v1/')

    await store.updateProviderConfig('openai-compatible', { apiKey: 'sk-key', baseUrl: 'https://other.example/v1/' }, 'configured')
    expect(store.getProviderConfig('openai-compatible')?.baseUrl).toBe('https://gateway.customer.example/v1/')
  })

  it('keeps the endpoints of speech and transcription providers', () => {
    brandState.inferenceBaseUrl = 'https://gateway.customer.example/v1/'
    const store = installStore()

    store.ensureProvider('openai-compatible-audio-speech', 'openai-compatible-audio-speech', { baseUrl: 'https://speech.example/v1/' })

    expect(store.getProviderConfig('openai-compatible-audio-speech')?.baseUrl).toBe('https://speech.example/v1/')
  })
})
