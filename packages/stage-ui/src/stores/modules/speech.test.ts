import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { toSignedPercent, useSpeechStore } from './speech'

const i18nState = vi.hoisted(() => ({
  locale: { value: 'en-US' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: i18nState.locale,
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('speech store helpers', () => {
  beforeEach(() => {
    i18nState.locale.value = 'en-US'
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })

  /**
   * @example
   * speechStore.resolveSpeechInput({ text, voice, providerConfig: { voice: 'plain' } })
   */
  it('leaves speech input unchanged by default', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'plain-voice',
      name: 'Plain Voice',
      provider: 'openai-compatible-audio-speech',
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveSpeechInput({
      text: 'hello',
      voice,
      providerConfig: { voice: 'plain-voice' },
    })

    expect(request.input).toBe('hello')
    expect(request.providerConfig).toEqual({ voice: 'plain-voice' })
  })

  it('applies configured pitch only when the custom provider supports SSML', () => {
    const speech = useSpeechStore()
    const voice = { id: 'voice-1', name: 'Voice 1', provider: 'microsoft-speech', languages: [{ code: 'en-US', title: 'English' }] }
    const input = { text: 'hello', voice, providerConfig: { pitch: 20 }, forceSSML: true }

    expect(speech.resolveSpeechInput({ ...input, supportsSSML: true }).input).toContain('pitch="+20%"')
    expect(speech.resolveSpeechInput({ ...input, supportsSSML: false }).input).toBe('hello')
  })

  it('keeps voice selection explicit for a custom voice catalog', async () => {
    const providers = useProviderStore()
    vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([
      { id: 'voice-a', name: 'Voice A', provider: 'openai-compatible-audio-speech', languages: [{ code: 'en-US', title: 'English' }] },
    ])
    const speech = useSpeechStore()
    await providers.initializeProvider('openai-compatible-audio-speech')
    await speech.selectProviderModel('openai-compatible-audio-speech', 'custom-model')
    await speech.loadVoicesForProvider('openai-compatible-audio-speech', 'custom-model')
    await speech.ensureActiveSpeechVoice()

    expect(speech.activeSpeechVoiceId).toBe('')
    speech.activeSpeechVoiceId = 'voice-a'
    await speech.ensureActiveSpeechVoice()
    expect(speech.activeSpeechVoice?.id).toBe('voice-a')
  })
})

describe('single model speech providers', () => {
  // Selecting a provider makes the speech store load its voices. Without a stub
  // the VOICEVOX entries reach for a real engine on localhost. The rejection
  // then logs after the file finishes, and the run fails on a teardown race.
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', async () => Response.json([]))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // https://github.com/moeru-ai/airi/issues/2166
  it('selects the only published model, so the provider is not left unconfigured — Issue #2166', async () => {
    // `settings/modules/speech.vue` clears `activeSpeechModel` on every provider
    // switch. Without the seeding below, a provider that publishes one model
    // keeps an empty model, `configured` stays false, and the stage never
    // speaks until the user opens the dropdown and picks that one entry.
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'voicevox'
    speechStore.activeSpeechModel = ''
    await providersStore.initializeProvider('voicevox')
    providersStore.providerRuntimeState.voicevox.models = [
      { id: 'default', name: 'VOICEVOX', provider: 'voicevox' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechModel).toBe('default')
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3967236129
  // ROOT CAUSE: Single-model defaults overwrote explicit names from the manual field.
  it('preserves a manually entered model through selection and catalog loading', async () => {
    const providers = useProviderStore()
    await providers.initializeProvider('openai-compatible-audio-speech')
    providers.providerRuntimeState['openai-compatible-audio-speech'].models = [
      { id: 'discovered', name: 'Discovered', provider: 'openai-compatible-audio-speech' },
    ]
    const speech = useSpeechStore()
    await speech.selectProviderModel('openai-compatible-audio-speech', 'manual-model')
    await speech.loadVoicesForProvider('openai-compatible-audio-speech', 'manual-model')
    expect(speech.activeSpeechModel).toBe('manual-model')
  })

  it('keeps the voice when it seeds the model, because voices belong to the provider', async () => {
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'voicevox'
    speechStore.activeSpeechModel = ''
    speechStore.activeSpeechVoiceId = '3'
    await providersStore.initializeProvider('voicevox')
    providersStore.providerRuntimeState.voicevox.models = [
      { id: 'default', name: 'VOICEVOX', provider: 'voicevox' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechVoiceId).toBe('3')
  })

  it('does not guess when a provider publishes several models', async () => {
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'elevenlabs'
    speechStore.activeSpeechModel = ''
    await providersStore.initializeProvider('elevenlabs')
    providersStore.providerRuntimeState.elevenlabs.models = [
      { id: 'eleven_v3', name: 'v3', provider: 'elevenlabs' },
      { id: 'eleven_flash_v2_5', name: 'flash', provider: 'elevenlabs' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechModel).toBe('')
  })
})

describe('vOICEVOX provider defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // https://github.com/moeru-ai/airi/issues/2166
  it('persists the neutral volume default, so a new provider is not silent — Issue #2166', async () => {
    // The settings form seeds `{ pitch: 0, speed: 1, volume: 0 }` when the
    // stored configuration carries no voice settings, and a `volumeScale` of
    // zero is silence. Provider metadata resolves asynchronously, so this pins
    // that `initializeProvider` waits for it before it writes the schema
    // defaults into the stored configuration.
    const providersStore = useProviderStore()
    const providerConfigStore = useProviderConfigStore()

    await providersStore.initializeProvider('voicevox')

    expect(providerConfigStore.getProviderConfig('voicevox')?.voiceSettings)
      .toEqual({ speed: 1, pitch: 0, intonation: 1, volume: 1 })
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3964660980
  // ROOT CAUSE: Every refresh cleared the catalog, even when its identity did
  // not change. A temporary failure then removed valid cached choices.
  it('retains the same catalog on refresh failure but clears it for a different model', async () => {
    const providers = useProviderStore()
    const voices = [{ id: 'cached', name: 'Cached', languages: [], provider: 'microsoft-speech' }]
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    await speech.loadVoicesForProvider('microsoft-speech', 'model-a')
    loads.mockRejectedValue(new Error('temporary outage'))
    await speech.loadVoicesForProvider('microsoft-speech', 'model-a')
    expect(speech.availableVoices['microsoft-speech']).toEqual(voices)
    expect(speech.voiceCatalogStatus['microsoft-speech']?.error).toBe('temporary outage')
    await speech.loadVoicesForProvider('microsoft-speech', 'model-b')
    expect(speech.availableVoices['microsoft-speech']).toEqual([])
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3966034981
  // ROOT CAUSE: Synthesis settings changed the catalog fingerprint and cleared
  // a valid selection. Each adapter must identify its discovery inputs.
  it.each(['elevenlabs', 'voicevox', 'microsoft-speech'])('retains %s selection after synthesis settings change', async (provider) => {
    const voices = [{ id: 'selected', name: 'Selected', languages: [], provider }]
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    await speech.selectProviderModel(provider, 'model')
    await vi.waitFor(() => expect(speech.isLoadingSpeechProviderVoices).toBe(false))
    const config = { apiKey: 'key', baseUrl: 'https://voices.invalid/', region: 'eastasia' }
    await speech.loadVoiceCatalog(provider, 'model', { definitionId: provider, config })
    speech.activeSpeechVoiceId = 'selected'
    await speech.ensureActiveSpeechVoice()
    await speech.loadVoiceCatalog(provider, 'model', {
      definitionId: provider,
      config: { ...config, pitch: 1, speed: 1.2, volume: 0.8, style: 'happy', voiceSettings: { stability: 0.7 } },
    })
    expect(speech.activeSpeechVoiceId).toBe('selected')
    expect(speech.activeSpeechVoice?.id).toBe('selected')
    expect(speech.configured).toBe(true)
  })

  it('invalidates cached voices when configuration changes or the provider session expires', async () => {
    const providers = useProviderStore()
    const voices = [{ id: 'cached', name: 'Cached', languages: [], provider: 'microsoft-speech' }]
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    const original = { definitionId: 'microsoft-speech', config: { baseUrl: 'https://old.invalid/' } }
    const changed = { definitionId: 'microsoft-speech', config: { baseUrl: 'https://new.invalid/' } }
    await speech.loadVoiceCatalog('microsoft-speech', 'model-a', original)
    loads.mockRejectedValue(new Error('configuration unavailable'))
    await expect(speech.loadVoiceCatalog('microsoft-speech', 'model-a', changed)).rejects.toThrow('configuration unavailable')
    expect(speech.availableVoices['microsoft-speech']).toEqual([])
    loads.mockResolvedValue(voices)
    await speech.loadVoiceCatalog('microsoft-speech', 'model-a', changed)
    loads.mockResolvedValue(undefined)
    await speech.loadVoiceCatalog('microsoft-speech', 'model-a', changed)
    expect(speech.availableVoices['microsoft-speech']).toEqual([])
    expect(speech.voiceCatalogIdentities['microsoft-speech']).toBeUndefined()
  })

  it('discards a request reset while its configuration fingerprint is pending', async () => {
    const providers = useProviderStore()
    const original = providers.getVoiceCatalogIdentity.bind(providers)
    let finish!: () => void
    const barrier = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.spyOn(providers, 'getVoiceCatalogIdentity').mockImplementation(async (model, configuration) => {
      const identity = await original(model, configuration)
      if (model === 'delayed')
        await barrier
      return identity
    })
    const requests = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    const pending = speech.loadVoiceCatalog('microsoft-speech', 'delayed', { definitionId: 'microsoft-speech', config: {} })
    await speech.resetState()
    finish()
    await expect(pending).resolves.toEqual([])
    expect(requests.mock.calls.some(([, model]) => model === 'delayed')).toBe(false)
    expect(speech.availableVoices['microsoft-speech']).toBeUndefined()
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3964866488
  it('keeps large provider samples out of replicated speech state', async () => {
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    await speech.loadVoiceCatalog('microsoft-speech', 'model-a', {
      definitionId: 'microsoft-speech',
      config: { voiceSample: 'private-sample'.repeat(100000) },
    })
    const state = JSON.stringify({ settings: speech.$state, identities: speech.voiceCatalogIdentities })
    expect(state.length).toBeLessThan(2000)
    expect(state).not.toContain('private-sample')
  })
  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3963756330
  // ROOT CAUSE: A background provider's newer request hid the active provider's pending state and error.
  it('keeps active provider status when another provider finishes first', async () => {
    const providers = useProviderStore()
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    speech.activeSpeechProvider = 'microsoft-speech'
    await new Promise(resolve => setTimeout(resolve, 20))
    let rejectActive!: (error: Error) => void
    loads.mockImplementation(async (provider) => {
      if (provider === 'microsoft-speech') {
        return new Promise((_resolve, reject) => {
          rejectActive = reject
        })
      }
      return []
    })
    const active = speech.loadVoicesForProvider('microsoft-speech')
    try {
      await vi.waitFor(() => expect(rejectActive).toBeDefined())
      await speech.loadVoicesForProvider('speech-noop')
      expect(speech.isLoadingSpeechProviderVoices).toBe(true)
      rejectActive(new Error('active provider failed'))
      await active
      expect(speech.speechProviderError).toBe('active provider failed')
      expect(speech.isLoadingSpeechProviderVoices).toBe(false)
    }
    finally {
      rejectActive?.(new Error('test cleanup'))
      await active
    }
  })
})
