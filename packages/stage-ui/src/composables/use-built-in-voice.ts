import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useAiriCardStore } from '../stores/modules/airi-card'
import { useSpeechStore } from '../stores/modules/speech'
import { useProviderStore } from '../stores/providers/provider'

/** The built-in voice. The `local-speech` provider owns the fixed model and voice IDs. */
export const builtInVoice = { provider: 'local-speech', model: 'built-in', voice_id: 'built-in' } as const

/** The silent selection. The speech module treats `speech-noop` as no voice. */
const silentVoice = { provider: 'speech-noop', model: '', voice_id: '' } as const

/**
 * Turns the built-in voice on and off for the active character.
 *
 * Onboarding and Speech settings share it. The active card owns its voice. Without an active card, the runtime selection is the only owner.
 */
export function useBuiltInVoice() {
  const providersStore = useProviderStore()
  const cardStore = useAiriCardStore()
  const speechStore = useSpeechStore()
  const { activeSpeechProvider } = storeToRefs(speechStore)

  const enabled = computed(() => activeSpeechProvider.value === builtInVoice.provider)

  /** Reports whether this host contains the voice. Web registers no host, so it reports false. */
  async function isAvailable() {
    const result = await providersStore.validateProviderConfig(builtInVoice.provider, {}).catch(() => ({ valid: false }))
    return result.valid
  }

  async function select(selection: { provider: string, model: string, voice_id: string }) {
    if (!await cardStore.updateActiveCardSpeech(selection))
      await speechStore.selectProviderModel(selection.provider, selection.model, selection.voice_id)
  }

  async function enable() {
    await providersStore.initializeProvider(builtInVoice.provider)
    await providersStore.forceProviderConfigured(builtInVoice.provider)
    await select(builtInVoice)
  }

  async function disable() {
    await select(silentVoice)
  }

  return { enabled, isAvailable, enable, disable }
}
