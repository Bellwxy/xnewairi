import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useAuthStore } from './auth'
import { useOnboardingStore } from './onboarding'
import { useProviderConfigStore } from './providers/config'
import { useProviderStore } from './providers/provider'

describe('custom-provider onboarding state', () => {
  let pinia: ReturnType<typeof createPinia>
  let app: App

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    app = createApp({
      setup() {
        useProviderStore()
        return () => null
      },
    })
    app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(document.createElement('div'))
    setActivePinia(pinia)
  })

  afterEach(() => {
    app.unmount()
    disposePinia(pinia)
  })

  it('requires provider setup even when an account is signed in', async () => {
    const now = new Date()
    useAuthStore().$patch({
      user: { id: 'user', name: 'User', email: 'user@example.test', emailVerified: true, createdAt: now, updatedAt: now },
      session: { id: 'session', userId: 'user', token: 'session-token', createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000) },
      token: 'access-token',
    })
    await nextTick()

    const onboarding = useOnboardingStore()
    expect(onboarding.needsOnboarding).toBe(true)
    expect(onboarding.hasCompletedSetup).toBe(false)
    expect(useProviderStore().allChatProvidersMetadata.some(provider => provider.id.startsWith('official-provider'))).toBe(false)
  })

  it('keeps a configured custom provider usable without an account', async () => {
    const providers = useProviderStore()
    await providers.initializeProvider('openai-compatible')
    expect(useProviderConfigStore().getProviderConfig('openai-compatible')?.baseUrl).toBe('')
    await useProviderConfigStore().patchProviderConfig('openai-compatible', { apiKey: 'custom-key', baseUrl: 'https://model.example.test/v1/' })
    await providers.forceProviderConfigured('openai-compatible')

    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useOnboardingStore().needsOnboarding).toBe(false)
    expect(useProviderConfigStore().getProviderConfig('openai-compatible')?.apiKey).toBe('custom-key')
  })

  it('exposes only custom endpoints in all client catalogs', async () => {
    const providers = useProviderStore()
    await expect.poll(() => providers.allChatProvidersMetadata.map(provider => provider.id)).toEqual(['openai-compatible'])
    expect(providers.allVisionProvidersMetadata.map(provider => provider.id)).toEqual(['vision-openai-compatible'])
    expect(providers.allAudioSpeechProvidersMetadata.map(provider => provider.id)).toEqual(['openai-compatible-audio-speech'])
    expect(providers.allAudioTranscriptionProvidersMetadata.map(provider => provider.id)).toEqual(['openai-compatible-audio-transcription'])
    expect(providers.availableProvidersMetadata.every(provider => provider.localizedName === 'Custom Provider')).toBe(true)
    expect(providers.availableProvidersMetadata.every(provider => provider.defaultConfig.baseUrl === '')).toBe(true)
  })

  it('keeps custom instances visible and excludes configured presets', async () => {
    const providers = useProviderStore()
    const configs = useProviderConfigStore()
    await configs.ensureProvider('my-gateway', 'openai-compatible', { apiKey: 'custom-key', baseUrl: 'https://model.example.test/v1/' })
    await configs.ensureProvider('openai', 'openai', { apiKey: 'preset-key' })
    await providers.forceProviderConfigured('my-gateway')
    await providers.forceProviderConfigured('openai')

    await expect.poll(() => providers.allChatProvidersMetadata.map(provider => provider.id)).toEqual(['openai-compatible', 'my-gateway'])
    expect(providers.moduleChatProvidersMetadata.map(provider => provider.id)).toEqual(['my-gateway'])
  })
})
