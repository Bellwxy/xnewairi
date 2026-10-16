import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { accountStorageKey } from '@proj-airi/stage-shared/account-scope/runtime'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { useCharacterOrchestratorStore } from '../character/orchestrator'
import { useProactiveCareStore } from '../character/proactive'
import { useDisplayModelsStore } from '../display-models'
import { useAiriCardStore } from '../modules/airi-card'
import { useArtistryStore } from '../modules/artistry'
import { useConsciousnessStore } from '../modules/consciousness'
import { useSpeechStore } from '../modules/speech'
import { useVisionStore } from '../modules/vision'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useMemorySettingsStore } from './memory-settings'

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

/** One window: a Pinia with the synchronization plugin, and the stores that the tested stores create. */
function createWindow(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ callTimeout: 2000, leadership, namespace })
  pinia.use(runtime.plugin)
  let stores: { settings: ReturnType<typeof useMemorySettingsStore>, proactive: ReturnType<typeof useProactiveCareStore> } | undefined
  const app = createApp({
    setup() {
      // These stores call `useI18n` and must exist before other stores first use them.
      useProviderStore()
      useConsciousnessStore()
      useVisionStore()
      useSpeechStore()
      useArtistryStore()
      useSettingsStageModel()
      useDisplayModelsStore()
      useAiriCardStore()
      useCharacterOrchestratorStore()
      stores = { settings: useMemorySettingsStore(), proactive: useProactiveCareStore() }
      return () => null
    },
  })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en } })).use(pinia).mount(document.createElement('div'))
  if (!stores)
    throw new Error('Stores did not initialize')
  contexts.push({ app, pinia, runtime })
  return { runtime, ...stores }
}

async function createWindows() {
  const namespace = `brain-sync:${crypto.randomUUID()}`
  const leader = createWindow(namespace, 'leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  const follower = createWindow(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  return { leader, follower }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.app.unmount()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  localStorage.clear()
})

it('keeps the call quota of the leader when another window changes a setting', async () => {
  const { leader, follower } = await createWindows()
  for (let call = 0; call < 3; call++)
    await leader.settings.spendCall()

  await follower.settings.setEnabled(false)
  await follower.settings.setExtractionOverride({ provider: 'other', model: 'small' })

  await expect.poll(() => leader.settings.enabled).toBe(false)
  expect(leader.settings.quota.count).toBe(3)
  expect(leader.settings.extractionOverride).toEqual({ provider: 'other', model: 'small' })
  await expect.poll(() => follower.settings.quota.count).toBe(3)
  expect(JSON.parse(localStorage.getItem(accountStorageKey('settings/memory/quota')) ?? '{}').count).toBe(3)
})

it('keeps the activity and fired history of the leader when another window adds a routine', async () => {
  const { leader, follower } = await createWindows()
  const at = new Date(2026, 9, 16, 9, 0).getTime()
  await leader.proactive.recordInteraction(at)
  await leader.proactive.markFired('morning-greeting', at)

  await follower.proactive.addCustomRoutine('default', 20 * 60, 'Talk about the day')

  await expect.poll(() => leader.proactive.customRoutines.default?.length).toBe(1)
  expect(leader.proactive.activity).toEqual([{ day: '2026-10-16', first: 9 * 60, last: 9 * 60 }])
  expect(leader.proactive.history.lastFiredAt['morning-greeting']).toBe(at)
})
