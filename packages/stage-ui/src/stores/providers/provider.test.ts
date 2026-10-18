import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProviderConfigStore } from './config'
import { useProviderStore } from './provider'

// The signed-in user owns the page account, as after the account switch reloads the page.
vi.mock('@proj-airi/stage-shared/account-scope/runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('@proj-airi/stage-shared/account-scope/runtime')>()
  const { AccountScope } = await import('@proj-airi/stage-shared/account-scope')
  return { ...runtime, getAccountScope: () => new AccountScope('user-1') }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('provider store synchronization boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ object: 'list', data: [] })))
  })

  afterEach(() => vi.unstubAllGlobals())

  // ROOT CAUSE:
  //
  // Provider actions, serializable runtime data, and computedAsync output
  // shared one synced store. Applying the derived ref in every Electron
  // renderer restarted its local async computation, which proposed another
  // snapshot and starved the main window's event loop.
  //
  // We fixed this by keeping executable actions in the provider store and
  // placing the replicated data in an internal state-only store.
  it('keeps replicated runtime data out of the executable provider store state', () => {
    const store = useProviderStore()
    const runtimeState = {
      models: [],
      defaultModel: null,
      modelStatus: 'ready' as const,
      modelError: null,
    }

    store.providerRuntimeState.openai = runtimeState

    expect(store.$state).not.toHaveProperty('providerRuntimeState')
    expect(store.$state).not.toHaveProperty('providerAvailabilityOverrides')
    expect(store.providerRuntimeState.openai).toEqual(runtimeState)
  })

  // ROOT CAUSE:
  //
  // The provider store installed immediate watchers that called synchronized
  // background actions. Every renderer created the same watchers, so one
  // shared state transition produced one routed action per renderer.
  //
  // We fixed this by keeping background work behind explicit action calls.
  it('does not start background provider actions when shared configuration changes', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()

    await nextTick()
    await new Promise<void>(resolve => queueMicrotask(resolve))

    const refreshValidation = vi.spyOn(store, 'refreshListedProviderValidation').mockResolvedValue()
    const refreshModels = vi.spyOn(store, 'refreshModelsForChangedCredentials').mockResolvedValue()

    configStore.ensureProvider('openai', 'openai', { apiKey: 'test-key' })
    await nextTick()
    await new Promise<void>(resolve => queueMicrotask(resolve))

    expect(refreshValidation).not.toHaveBeenCalled()
    expect(refreshModels).not.toHaveBeenCalled()
  })

  // ROOT CAUSE:
  //
  // Provider metadata projection called the config store's `getProvider`
  // action once for every registered provider. Pinia tracing and plugins then
  // processed hundreds of action lifecycle events during renderer startup,
  // even though each call was only a read.
  // Internal provider projections now read the reactive provider map directly.
  it('does not dispatch config actions while projecting provider metadata', async () => {
    const configStore = useProviderConfigStore()
    let getProviderCalls = 0
    configStore.$onAction(({ name }) => {
      if (name === 'getProvider')
        getProviderCalls += 1
    })

    useProviderStore()
    await nextTick()

    expect(getProviderCalls).toBe(0)
  })

  // ROOT CAUSE:
  //
  // Speech settings pages wrote defaults into the computed `configs` map before
  // provider initialization. The derived entry made `initializeProvider` skip
  // the source provider record, so later input was not persisted.
  //
  // The provider record is now the only existence check. A derived entry cannot
  // prevent initialization of the persisted source state.
  // https://github.com/moeru-ai/airi/issues/2449
  it('creates the provider when only a derived configuration entry exists (Issue #2449)', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()

    configStore.configs['openai-compatible-audio-speech'] = { model: 'qwen' }

    expect(configStore.getProvider('openai-compatible-audio-speech')).toBeUndefined()

    await store.initializeProvider('openai-compatible-audio-speech')

    expect(configStore.getProvider('openai-compatible-audio-speech')).toMatchObject({
      id: 'openai-compatible-audio-speech',
      definitionId: 'openai-compatible-audio-speech',
    })
  })

  it('uses the current interface language when Sherpaw is first configured', async () => {
    let storedLanguage = 'en'
    vi.stubGlobal('localStorage', { getItem: () => storedLanguage })

    try {
      const store = useProviderStore()
      const configStore = useProviderConfigStore()

      await store.initializeProvider('speech-noop')
      storedLanguage = 'zh-Hans'
      await store.initializeProvider('sherpaw-transcription')

      expect(configStore.getProviderConfig('sherpaw-transcription')).toMatchObject({
        model: 'paraformer-zh-en',
        modelLanguageFilter: 'zh',
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  // ROOT CAUSE:
  //
  // getModelsForProvider created a new empty array for every cache miss.
  // Reactive consumers observed a false list change after each synced patch.
  //
  // We fixed this by returning one frozen fallback until a catalog exists.
  it('reuses the empty model-list fallback', () => {
    const store = useProviderStore()

    const first = store.getModelsForProvider('missing-provider')
    const second = store.getModelsForProvider('missing-provider')

    expect(second).toBe(first)
    expect(second).toEqual([])
  })

  it.each(['openai', 'deepseek'])('rejects an LLM request to %s, which is not the gateway', async (providerId) => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    configStore.ensureProvider(providerId, providerId, {
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1/',
    })

    await expect(store.getChatProviderInstance(providerId)).rejects.toThrow('is not the gateway')
  })

  it('serves LLM requests through the gateway provider and its vision instance', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    const config = { apiKey: 'gateway-key', baseUrl: 'https://gateway.example/v1/' }
    configStore.ensureProvider('openai-compatible', 'openai-compatible', config)
    configStore.ensureProvider('vision-openai-compatible', 'openai-compatible', config)

    const chat = await store.getChatProviderInstance('openai-compatible')
    const vision = await store.getChatProviderInstance('vision-openai-compatible')

    expect(chat.generation('gateway-chat').config).toMatchObject({ model: 'gateway-chat', baseURL: 'https://gateway.example/v1/' })
    expect(vision.generation('gateway-vision').config).toMatchObject({ model: 'gateway-vision' })
  })

  // https://github.com/moeru-ai/airi/pull/2471#discussion_r3999470560
  it('drops a cached instance when replicated credentials change without a local sync', async () => {
    // ROOT CAUSE:
    //
    // onAfterSync ran only inside the leader-routed syncProviders action.
    // The chat window is follower-only. It received the new key in the
    // replicated snapshot and kept the old client in providerInstanceCache.
    //
    // Each renderer now watches replicated credentials and drops its own cache.
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    configStore.ensureProvider('openai', 'openai', {
      apiKey: 'sk-old',
      baseUrl: 'https://api.openai.com/v1/',
    })
    const first = await store.getProviderInstance('openai')

    configStore.providers.openai = {
      ...configStore.providers.openai!,
      config: {
        apiKey: 'sk-new',
        baseUrl: 'https://api.openai.com/v1/',
      },
    }

    const second = await store.getProviderInstance('openai')
    expect(second).not.toBe(first)
  })
})
