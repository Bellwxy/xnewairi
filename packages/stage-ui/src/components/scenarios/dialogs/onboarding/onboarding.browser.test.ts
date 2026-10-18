import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import OnboardingDialog from './onboarding.vue'
import StepProviderConfiguration from './step-provider-configuration.vue'

import { useAuthStore } from '../../../../stores/auth'
import { useDisplayModelsStore } from '../../../../stores/display-models'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useArtistryStore } from '../../../../stores/modules/artistry'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useSpeechStore } from '../../../../stores/modules/speech'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'
import { useSettingsStageModel } from '../../../../stores/settings/stage-model'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const syncedContexts: Array<{
  app: App
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
}> = []

function createSyncedContext(namespace: string, leadership: LeadershipMode, options: { withCards?: boolean } = {}) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  let providerStore: ReturnType<typeof useProviderStore> | undefined
  let providerConfigStore: ReturnType<typeof useProviderConfigStore> | undefined
  const app = createApp({
    setup() {
      providerStore = useProviderStore()
      providerConfigStore = useProviderConfigStore()
      // The card store owns the chat defaults. Its dependencies call `useI18n`, so they start in setup.
      if (options.withCards) {
        useConsciousnessStore()
        useSpeechStore()
        useArtistryStore()
        useSettingsStageModel()
        useDisplayModelsStore()
        useAiriCardStore()
      }
      return () => null
    },
  })
  app
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .use(pinia)
    .mount(document.createElement('div'))
  if (!providerStore || !providerConfigStore)
    throw new Error('Provider stores did not initialize')

  syncedContexts.push({ app, pinia, runtime })
  return { pinia, providerConfigStore, providerStore, runtime }
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

beforeEach(() => {
  localStorage.clear()
  // The validators, model listing, and the ping check all run against the
  // configured gateway. One stub answers every OpenAI-compatible endpoint.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'grok-4.6',
        choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }
    return Response.json({ object: 'list', data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }] })
  }))
})

afterEach(() => {
  for (const context of syncedContexts.splice(0)) {
    context.app.unmount()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
})

it('opens custom-provider setup without a login request in either renderer', async () => {
  vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
  const namespace = `onboarding-login:${crypto.randomUUID()}`
  const leader = createSyncedContext(namespace, 'leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  const follower = createSyncedContext(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  const screen = await render(OnboardingDialog, {
    global: { plugins: [follower.pinia, PiniaColada, createTestI18n()] },
  })

  await screen.getByRole('button', { name: 'Setup with your provider' }).click()

  await expect.element(screen.getByRole('heading', { name: 'Configure Custom Provider' })).toBeInTheDocument()
  await expect.element(screen.getByText('Choose an AI Provider')).not.toBeInTheDocument()
  for (const name of ['OpenAI', 'Azure OpenAI', 'Anthropic | Claude', 'Amazon Bedrock', 'Google Gemini', 'Groq', 'OpenRouter', 'Ollama', 'DeepSeek', 'OpenAI Compatible']) {
    await expect.element(screen.getByText(name, { exact: true })).not.toBeInTheDocument()
  }
  await expect.element(page.getByPlaceholder('https://api.example.com/v1/')).toHaveValue('')
  await expect.element(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByPlaceholder('API Key').fill('custom-key')
  await expect.element(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(useAuthStore(leader.pinia).needsLogin).toBe(false)
  expect(useAuthStore(follower.pinia).needsLogin).toBe(false)
})

// ROOT CAUSE:
//
// saveProviderConfiguration wrote credentials through the `configs` computed
// projection, so the save never reached the owning synchronized state and was
// discarded on recompute — fetchModelsForProvider then returned an empty
// catalog ("no models available") despite validation succeeding.
//
// The desktop onboarding window is a sync follower; this test drives the real
// dialog there and asserts the save reaches the leader and localStorage.
it('persists configured credentials through the leader and loads the model list', async () => {
  const namespace = `onboarding-dialog:${crypto.randomUUID()}`
  const leader = createSyncedContext(namespace, 'leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)

  const follower = createSyncedContext(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)

  const screen = await render(OnboardingDialog, {
    global: { plugins: [follower.pinia, PiniaColada, createTestI18n()] },
  })

  await screen.getByRole('button', { name: 'Setup with your provider' }).click()

  const apiKeyInput = page.getByPlaceholder('API Key')
  await expect.element(apiKeyInput).toBeInTheDocument()
  await apiKeyInput.fill('sk-test-onboarding')
  await page.getByPlaceholder('https://api.example.com/v1/').fill('https://gateway.example.test/v1/')
  await screen.getByRole('button', { name: 'Next' }).click()

  const providerId = 'openai-compatible'
  const expectedConfig = { apiKey: 'sk-test-onboarding', baseUrl: 'https://gateway.example.test/v1/' }

  // The leader owns persistence and must hold the saved credentials.
  await expect.poll(() => leader.providerConfigStore.getProviderConfig(providerId)).toMatchObject(expectedConfig)
  // The dialog saves the config and then the status, each through its own
  // leader call, so the status can reach the leader after the config.
  await expect.poll(() => leader.providerConfigStore.providers[providerId]?.status).toBe('configured')
  await expect.poll(() => leader.providerConfigStore.addedProviders[providerId]).toBe(true)

  await expect.poll(() => JSON.parse(localStorage.getItem(accountStorageKey('settings/providers/configured')) ?? '{}')).toMatchObject({
    [providerId]: { config: expectedConfig },
  })

  // The model list loads through the leader and becomes visible in the
  // follower's replicated runtime state.
  await expect.poll(
    () => follower.providerStore.getModelsForProvider(providerId).map(model => model.id),
    { timeout: 10_000 },
  ).toContain('grok-4.6')
  // Onboarding has no model step. Without a brand model, it selects the first model that the gateway lists.
  await expect.poll(() => useConsciousnessStore(follower.pinia).activeModel).toBe('grok-4.6')
  await expect.element(screen.getByText('grok-4.5')).not.toBeInTheDocument()
})

// ROOT CAUSE:
//
// The configuration step kept its form in component-local refs and reset them
// in initializeForm() on every mount. Each step change remounts the step, so
// going back from model selection wiped the typed API key and restored the
// default base URL.
it('rehydrates the configuration form from the saved provider configuration', async () => {
  const context = createSyncedContext(`onboarding-step:${crypto.randomUUID()}`, 'leader-only')
  await context.providerConfigStore.ensureProvider('openai-compatible', 'openai-compatible', {})
  await context.providerConfigStore.patchProviderConfig('openai-compatible', {
    apiKey: 'sk-saved-key',
    baseUrl: 'https://saved.example.com/v1',
  })

  await vi.waitFor(() => {
    expect(context.providerStore.allChatProvidersMetadata.some(provider => provider.id === 'openai-compatible')).toBe(true)
  })
  const metadata = context.providerStore.allChatProvidersMetadata.find(provider => provider.id === 'openai-compatible')
  if (!metadata)
    throw new Error('openai-compatible metadata did not initialize')

  await render(StepProviderConfiguration, {
    props: {
      selectedProviderId: 'openai-compatible',
      selectedProvider: metadata,
      onNext: () => {},
      onPrevious: () => {},
    },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await expect.element(page.getByPlaceholder('API Key')).toHaveValue('sk-saved-key')
  await expect.element(page.getByPlaceholder('https://api.example.com/v1/')).toHaveValue('https://saved.example.com/v1')
})

it('stays on the configuration step with a retry when the gateway lists no chat model', async () => {
  let listedModels: Array<{ id: string }> = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions'))
      return Response.json({ error: { message: 'no model' } }, { status: 404 })
    return Response.json({ object: 'list', data: listedModels })
  }))
  const namespace = `onboarding-empty-catalog:${crypto.randomUUID()}`
  const leader = createSyncedContext(namespace, 'leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  const follower = createSyncedContext(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  const screen = await render(OnboardingDialog, {
    global: { plugins: [follower.pinia, PiniaColada, createTestI18n()] },
  })

  await screen.getByRole('button', { name: 'Setup with your provider' }).click()
  await page.getByPlaceholder('API Key').fill('sk-test-onboarding')
  await page.getByPlaceholder('https://api.example.com/v1/').fill('https://gateway.example.test/v1/')
  await screen.getByRole('button', { name: 'Next' }).click()
  await screen.getByRole('button', { name: 'Continue anyway' }).click()

  await expect.element(screen.getByText('No chat model found')).toBeInTheDocument()
  await expect.element(screen.getByRole('heading', { name: 'Configure Custom Provider' })).toBeInTheDocument()
  expect(useConsciousnessStore(follower.pinia).activeModel).toBe('')

  listedModels = [{ id: 'grok-4.6' }]
  // The alert retries the catalog. The main button would run the failing validation again.
  await screen.getByRole('button', { name: 'Retry', exact: true }).first().click()

  await expect.poll(() => useConsciousnessStore(follower.pinia).activeModel).toBe('grok-4.6')
  await expect.element(screen.getByRole('heading', { name: 'Configure Custom Provider' })).not.toBeInTheDocument()
})

it('gives the first chat the selected model after the character and voice steps are skipped', async () => {
  const namespace = `onboarding-skip-steps:${crypto.randomUUID()}`
  const leader = createSyncedContext(namespace, 'leader-only', { withCards: true })
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  // The app initializes the cards at startup, before onboarding selects a model.
  await useAiriCardStore(leader.pinia).initialize()
  const follower = createSyncedContext(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  const onConfigured = vi.fn()
  const screen = await render(OnboardingDialog, {
    props: { onConfigured },
    global: { plugins: [follower.pinia, PiniaColada, createTestI18n()] },
  })

  await screen.getByRole('button', { name: 'Setup with your provider' }).click()
  await page.getByPlaceholder('API Key').fill('sk-test-onboarding')
  await page.getByPlaceholder('https://api.example.com/v1/').fill('https://gateway.example.test/v1/')
  await screen.getByRole('button', { name: 'Next' }).click()
  await screen.getByRole('button', { name: 'Skip and use the default character' }).click()
  // This browser has no built-in voice and no bundled recognizer, so the voice step finishes by itself.
  await vi.waitFor(() => expect(onConfigured).toHaveBeenCalledOnce())

  // A chat reads the character selection, which inherits the card defaults.
  await expect.poll(() => useAiriCardStore(leader.pinia).getModules('default').consciousness).toEqual({
    provider: 'openai-compatible',
    model: 'grok-4.6',
  })
})
