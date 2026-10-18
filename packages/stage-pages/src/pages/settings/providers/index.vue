<script setup lang="ts">
import { IconStatusItem, RippleGrid } from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { GhostButton } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const providersStore = useProviderStore()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()
const { trackProviderClick } = useAnalytics()

const providerBlocks = computed(() => [
  { id: 'chat', icon: 'i-solar:chat-square-like-bold-duotone', providers: providersStore.allChatProvidersMetadata },
  { id: 'speech', icon: 'i-solar:user-speak-rounded-bold-duotone', providers: providersStore.allAudioSpeechProvidersMetadata },
  { id: 'transcription', icon: 'i-solar:microphone-3-bold-duotone', providers: providersStore.allAudioTranscriptionProvidersMetadata },
].map(block => ({ ...block, title: t(`settings.pages.providers.categories.${block.id}.title`) })))

const initialTabId = route.hash.slice(1)
const activeTabId = ref(providerBlocks.value.some(block => block.id === initialTabId) ? initialTabId : 'chat')
const activeBlocks = computed(() => providerBlocks.value.filter(block => block.id === activeTabId.value))

async function setActiveTab(id: string) {
  activeTabId.value = id
  await router.replace({ hash: `#${id}` })
}
</script>

<template>
  <div :class="['mb-6 pb-10', 'flex flex-col gap-5']">
    <div :class="['flex flex-wrap gap-2']">
      <GhostButton
        v-for="block in providerBlocks"
        :key="block.id"
        :icon="block.icon"
        :label="block.title"
        :active="activeTabId === block.id"
        :aria-pressed="activeTabId === block.id"
        @click="setActiveTab(block.id)"
      />
    </div>
    <RippleGrid
      :sections="activeBlocks"
      :get-items="block => block.providers"
      :columns="{ default: 1, sm: 2, xl: 3 }"
      :origin-index="lastClickedIndex"
      @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
    >
      <template #header="{ section: block }">
        <h2 :class="['flex items-center gap-2 text-xl font-normal']">
          <span :class="[block.icon]" aria-hidden="true" />
          {{ block.title }}
        </h2>
      </template>
      <template #item="{ item: provider }">
        <IconStatusItem
          :title="provider.localizedName"
          :description="provider.localizedDescription"
          :icon="provider.icon"
          :to="provider.to ?? `/settings/providers/${provider.category}/${provider.id}`"
          :configured="provider.configured"
          @click="trackProviderClick(provider.id, provider.category)"
        />
      </template>
    </RippleGrid>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.providers.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.providers.description
  icon: i-solar:box-minimalistic-bold-duotone
  settingsEntry: true
  order: 6
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
