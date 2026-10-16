import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

/** A provider and model that the user chose in the advanced section. Empty strings mean the automatic value. */
export interface MemoryModelOverride {
  provider: string
  model: string
}

/**
 * `auto` detects an embedding model at the chat endpoint. `custom` uses the advanced override. `off` uses keywords only.
 */
export type EmbeddingMode = 'auto' | 'custom' | 'off'

/** The result of one embedding detection. `model` is empty when the endpoint offers no usable embedding model. */
export interface EmbeddingDetection {
  /** Provider id, endpoint address, and chat model id. A change of any of them starts a new detection. */
  key: string
  model: string
  checkedAt: number
}

/** Each account runs at most this many background model calls per local day. Spec 2.1 sets 50 as the first value. */
export const dailyBackgroundCallLimit = 50

/**
 * Formats a timestamp as the local calendar day.
 *
 * @example
 * localDay(new Date(2026, 9, 16, 23, 59).getTime())
 * // => '2026-10-16'
 */
function localDay(at: number) {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Pinia synchronization owns cross-window updates, so storage events stay off, as in the card store.
 * Every write is a synchronized action, so the leader applies only the change, never a full snapshot of an older window.
 */
const storageOptions = { listenToStorageChanges: false }

/**
 * Memory settings of the account. Only the switch is visible by default. The rest belongs to the advanced section.
 *
 * Pages call the actions. The leader runs them, persists the result, and replicates it to every window.
 */
export const useMemorySettingsStore = defineStore('memory-settings', () => {
  const enabled = useLocalStorageManualReset<boolean>('settings/memory/enabled', true, storageOptions)
  const extractionOverride = useLocalStorageManualReset<MemoryModelOverride>('settings/memory/extraction-override', { provider: '', model: '' }, storageOptions)
  const embeddingMode = useLocalStorageManualReset<EmbeddingMode>('settings/memory/embedding-mode', 'auto', storageOptions)
  const embeddingOverride = useLocalStorageManualReset<MemoryModelOverride>('settings/memory/embedding-override', { provider: '', model: '' }, storageOptions)
  const embeddingDetection = useLocalStorageManualReset<EmbeddingDetection | null>('settings/memory/embedding-detection', null, storageOptions)
  /** Providers that the user allowed to read chats for extraction. The chat provider never needs this. */
  const confirmedExtractionProviders = useLocalStorageManualReset<string[]>('settings/memory/confirmed-extraction-providers', [], storageOptions)
  const quota = useLocalStorageManualReset<{ day: string, count: number }>('settings/memory/quota', { day: '', count: 0 }, storageOptions)

  const hasExtractionOverride = computed(() => !!extractionOverride.value.provider && !!extractionOverride.value.model)

  /** Tells whether a background call can start now. The count resets on a new local day. */
  function canSpendCall(at = Date.now()) {
    return quota.value.day !== localDay(at) || quota.value.count < dailyBackgroundCallLimit
  }

  async function spendCall(at = Date.now()) {
    const day = localDay(at)
    quota.value = { day, count: quota.value.day === day ? quota.value.count + 1 : 1 }
  }

  async function setEnabled(value: boolean) {
    enabled.value = value
  }

  async function setExtractionOverride(value: MemoryModelOverride) {
    extractionOverride.value = { provider: value.provider.trim(), model: value.model.trim() }
  }

  async function setEmbeddingMode(value: EmbeddingMode) {
    embeddingMode.value = value
  }

  async function setEmbeddingOverride(value: MemoryModelOverride) {
    embeddingOverride.value = { provider: value.provider.trim(), model: value.model.trim() }
    // A new model means a new vector space, so the detection of the old one no longer applies.
    embeddingDetection.value = null
  }

  async function recordEmbeddingDetection(value: EmbeddingDetection) {
    embeddingDetection.value = value
  }

  async function confirmExtractionProvider(provider: string) {
    if (!confirmedExtractionProviders.value.includes(provider))
      confirmedExtractionProviders.value = [...confirmedExtractionProviders.value, provider]
  }

  async function resetState() {
    enabled.reset()
    extractionOverride.reset()
    embeddingMode.reset()
    embeddingOverride.reset()
    embeddingDetection.reset()
    confirmedExtractionProviders.reset()
    quota.reset()
  }

  return {
    enabled,
    extractionOverride,
    embeddingMode,
    embeddingOverride,
    embeddingDetection,
    confirmedExtractionProviders,
    quota,
    hasExtractionOverride,
    canSpendCall,
    spendCall,
    setEnabled,
    setExtractionOverride,
    setEmbeddingMode,
    setEmbeddingOverride,
    recordEmbeddingDetection,
    confirmExtractionProvider,
    resetState,
  }
}, {
  synced: {
    actions: ['spendCall', 'setEnabled', 'setExtractionOverride', 'setEmbeddingMode', 'setEmbeddingOverride', 'recordEmbeddingDetection', 'confirmExtractionProvider', 'resetState'],
    state: true,
  },
})
