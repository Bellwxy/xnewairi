import type { Component } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { MotionPlugin } from '@vueuse/motion'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import SpeechSettings from '../../../../stage-pages/src/pages/settings/modules/speech.vue'

import { injectKeyPiniaSynced } from '../../libs/pinia/synced-context'
import { setLocalSpeechHost } from '../../libs/providers/providers/local-speech'
import { useDisplayModelsStore } from '../display-models'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'
import { useArtistryStore } from './artistry'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'

const cleanups: Array<() => void> = []

/** Mounts a real renderer with a separate Pinia and BroadcastChannel runtime. */
function mountRenderer(namespace: string, page?: Component, options: { withCards?: boolean } = {}) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership: page ? 'follower-only' : 'leader-only' })
  pinia.use(runtime.plugin)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    setup() {
      useSpeechStore()
      // The card store owns the voice of the active character. Its dependencies call `useI18n`, so they start in setup.
      if (options.withCards) {
        useProviderStore()
        useConsciousnessStore()
        useArtistryStore()
        useSettingsStageModel()
        useDisplayModelsStore()
        useAiriCardStore()
      }
      return () => page ? h(page) : null
    },
  })
  const router = createRouter({ history: createMemoryHistory(), routes: [] })
  app.provide(injectKeyPiniaSynced, runtime)
    .use(pinia)
    .use(router)
    .use(MotionPlugin)
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .mount(container)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    runtime.dispose()
    container.remove()
  })
  return { app, pinia, runtime, container, speech: useSpeechStore(pinia) }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// https://github.com/moeru-ai/airi/actions/runs/34348745853/job/102456521103
// ROOT CAUSE: Page initialization and provider watchers awaited model RPCs
// without handling transport disposal. Passing assertions hid a teardown rejection.
it.each(['mount', 'provider change'])('handles interrupted model discovery after %s', async (trigger) => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], models: [], flux: 0 })))
  const namespace = `speech-settings:${crypto.randomUUID()}`
  const leader = mountRenderer(namespace)
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  await useProviderConfigStore(leader.pinia).ensureProvider('microsoft-speech', 'microsoft-speech', {
    apiKey: 'key',
    baseUrl: 'https://voices.invalid/v1/',
    region: 'eastasia',
  })
  await leader.speech.selectProviderModel('speech-noop', '')
  let completed = 0
  useProviderStore(leader.pinia).$onAction(({ name, after }) => {
    if (name === 'loadModelsForConfiguredProviders')
      after(() => completed++)
  })
  let blocked = 0
  let interrupt = trigger === 'mount'
  const postMessage = BroadcastChannel.prototype.postMessage
  vi.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(function (this: BroadcastChannel, message) {
    if (interrupt && JSON.stringify(message).includes('loadModelsForConfiguredProviders')) {
      blocked++
      return
    }
    postMessage.call(this, message)
  })
  const follower = mountRenderer(namespace, SpeechSettings)
  const globalErrors = vi.fn()
  follower.app.config.errorHandler = globalErrors
  if (trigger === 'provider change') {
    await vi.waitFor(() => expect(completed).toBeGreaterThan(0))
    interrupt = true
    await leader.speech.selectProviderModel('microsoft-speech', 'v1')
  }
  await vi.waitFor(() => expect(blocked).toBeGreaterThan(0))
  follower.runtime.dispose()
  await vi.waitFor(() => expect(globalErrors.mock.calls.length > 0 || follower.container.textContent?.includes('Pinia sync runtime was disposed before the RPC completed.')).toBe(true))
  expect(globalErrors).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(follower.container.textContent).toContain('Pinia sync runtime was disposed before the RPC completed.'))
})

it('turns the built-in voice on and off from the settings page', async () => {
  localStorage.clear()
  // The native voice is an Electron or Capacitor boundary. This host reports a voice and never synthesizes.
  setLocalSpeechHost({ availability: async () => ({ available: true }), synthesize: vi.fn() })
  cleanups.push(() => setLocalSpeechHost({ availability: async () => ({ available: false }), synthesize: vi.fn() }))
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ voices: [], data: [] })))
  const namespace = `speech-settings:${crypto.randomUUID()}`
  const leader = mountRenderer(namespace, undefined, { withCards: true })
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  await useAiriCardStore(leader.pinia).initialize()
  mountRenderer(namespace, SpeechSettings)

  const toggle = page.getByRole('switch', { name: /Built-in voice/ })
  await toggle.click()

  await vi.waitFor(() => expect(leader.speech.activeSpeechProvider).toBe('local-speech'))
  expect(leader.speech.activeSpeechModel).toBe('built-in')
  expect(leader.speech.activeSpeechVoiceId).toBe('built-in')

  await toggle.click()

  await vi.waitFor(() => expect(leader.speech.activeSpeechProvider).toBe('speech-noop'))
})
