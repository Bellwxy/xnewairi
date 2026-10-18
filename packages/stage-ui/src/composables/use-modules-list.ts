import type { BeatSyncDetectorState } from '@proj-airi/stage-shared/beat-sync'

import { getBeatSyncState, isBeatSyncSupported, listenBeatSyncStateChange } from '@proj-airi/stage-shared/beat-sync'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProactiveCareStore } from '../stores/character/proactive'
import { useMemorySettingsStore } from '../stores/memory/memory-settings'
import { useArtistryStore } from '../stores/modules/artistry'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useHearingStore } from '../stores/modules/hearing'
import { useSpeechStore } from '../stores/modules/speech'
import { useStickersStore } from '../stores/modules/stickers'
import { useWebSearchStore } from '../stores/modules/web-search'

export interface Module {
  id: string
  name: string
  description: string
  icon?: string
  iconColor?: string
  iconImage?: string
  to: string
  configured: boolean
  category: string
}

export function useModulesList() {
  const { t } = useI18n()

  // Initialize stores
  const consciousnessStore = useConsciousnessStore()
  const speechStore = useSpeechStore()
  const stickersStore = useStickersStore()
  const hearingStore = useHearingStore()
  const webSearchStore = useWebSearchStore()
  const artistryStore = useArtistryStore()
  const memorySettingsStore = useMemorySettingsStore()
  const proactiveCareStore = useProactiveCareStore()
  const beatSyncState = ref<BeatSyncDetectorState>()
  const beatSyncSupported = isBeatSyncSupported()

  const modulesList = computed<Module[]>(() => [
    {
      id: 'consciousness',
      name: t('settings.pages.modules.consciousness.title'),
      description: t('settings.pages.modules.consciousness.description'),
      icon: 'i-solar:ghost-bold-duotone',
      to: '/settings/modules/consciousness',
      configured: consciousnessStore.configured,
      category: 'essential',
    },
    {
      id: 'speech',
      name: t('settings.pages.modules.speech.title'),
      description: t('settings.pages.modules.speech.description'),
      icon: 'i-solar:user-speak-rounded-bold-duotone',
      to: '/settings/modules/speech',
      configured: speechStore.configured,
      category: 'essential',
    },
    {
      id: 'hearing',
      name: t('settings.pages.modules.hearing.title'),
      description: t('settings.pages.modules.hearing.description'),
      icon: 'i-solar:microphone-3-bold-duotone',
      to: '/settings/modules/hearing',
      configured: hearingStore.configured,
      category: 'essential',
    },
    {
      id: 'stickers',
      name: t('settings.pages.modules.stickers.title'),
      description: t('settings.pages.modules.stickers.description'),
      icon: 'i-solar:sticker-smile-circle-bold-duotone',
      to: '/settings/modules/stickers',
      configured: stickersStore.enabled,
      category: 'essential',
    },
    {
      id: 'web-search',
      name: t('settings.pages.modules.web-search.title'),
      description: t('settings.pages.modules.web-search.description'),
      icon: 'i-solar:magnifer-bold-duotone',
      to: '/settings/modules/web-search',
      configured: webSearchStore.configured,
      category: 'essential',
    },
    {
      id: 'artistry',
      name: t('settings.pages.modules.artistry.title'),
      description: t('settings.pages.modules.artistry.description'),
      icon: 'i-solar:palette-bold-duotone',
      to: '/settings/modules/artistry',
      configured: artistryStore.configured,
      category: 'essential',
    },
    {
      id: 'proactive-care',
      name: t('settings.pages.modules.proactive-care.title'),
      description: t('settings.pages.modules.proactive-care.description'),
      icon: 'i-solar:sun-fog-bold-duotone',
      to: '/settings/modules/proactive-care',
      configured: proactiveCareStore.enabled,
      category: 'essential',
    },
    {
      id: 'memory-long-term',
      name: t('settings.pages.modules.memory-long-term.title'),
      description: t('settings.pages.modules.memory-long-term.description'),
      icon: 'i-solar:book-bookmark-bold-duotone',
      to: '/settings/modules/memory-long-term',
      configured: memorySettingsStore.enabled,
      category: 'essential',
    },
    ...(beatSyncSupported
      ? [{
          id: 'beat-sync',
          name: t('settings.pages.modules.beat_sync.title'),
          description: t('settings.pages.modules.beat_sync.description'),
          icon: 'i-solar:music-notes-bold-duotone',
          to: '/settings/modules/beat-sync',
          configured: beatSyncState.value?.isActive ?? false,
          category: 'essential',
        }]
      : []),
  ])

  const categorizedModules = computed(() => {
    return modulesList.value.reduce((categories, module) => {
      const { category } = module
      if (!categories[category]) {
        categories[category] = []
      }
      categories[category].push(module)
      return categories
    }, {} as Record<string, Module[]>)
  })

  // Define category display names
  const categoryNames = computed(() => ({
    essential: t('settings.pages.modules.categories.essential'),
    messaging: t('settings.pages.modules.categories.messaging'),
    gaming: t('settings.pages.modules.categories.gaming'),
  }))

  // TODO(Makito): We can make this a reactive value from a synthetic store.
  onMounted(() => {
    if (!beatSyncSupported)
      return

    getBeatSyncState().then(initialState => beatSyncState.value = initialState)
    const removeListener = listenBeatSyncStateChange(newState => beatSyncState.value = { ...newState })
    onUnmounted(() => removeListener())
  })

  return {
    modulesList,
    categorizedModules,
    categoryNames,
  }
}
