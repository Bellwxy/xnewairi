<script setup lang="ts">
import { PaneArea } from '@proj-airi/stage-ui/components'
import { getDefinedProvider } from '@proj-airi/stage-ui/libs'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, Input } from '@proj-airi/ui'
import { breakpointsTailwind, refDebounced, useBreakpoints } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { Pane, Splitpanes } from 'splitpanes'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()
const providerStore = useProviderConfigStore()
const inferenceStore = useProviderStore()
const { availableProvidersMetadata } = storeToRefs(inferenceStore)

const availableProviderSearchQuery = ref('')
const availableProviderSearchQueryDebounced = refDebounced(availableProviderSearchQuery, 250)

const availableProviders = computed(() => {
  return availableProvidersMetadata.value
    .filter(provider => provider.category !== 'vision' && getDefinedProvider(provider.id))
    .map(provider => ({
      ...provider,
      nameLocalized: `${provider.localizedName} (${t(`settings.pages.providers.categories.${provider.category}.title`)})`,
    }))
})

const listedProviders = computed(() => availableProvidersMetadata.value.filter(provider => providerStore.listedProviders[provider.id]))

const availableProvidersFiltered = computed(() => {
  if (!availableProviderSearchQueryDebounced.value) {
    return availableProviders.value
  }

  return availableProviders.value.filter(provider =>
    provider.nameLocalized.toLowerCase().includes(availableProviderSearchQueryDebounced.value.toLowerCase()),
  )
})

const breakpoints = useBreakpoints(breakpointsTailwind)
const isSmallerThan2XL = breakpoints.smaller('2xl')

const paneDatasourceListSize = computed(() => isSmallerThan2XL.value ? 30 : 20)
const paneDatasourceEditSize = computed(() => isSmallerThan2XL.value ? 80 : 70)

async function handleAdd(providerId: string) {
  await providerStore.addProvider(providerId, inferenceStore.getDefaultProviderConfig(providerId))
}

function handleClick(providerId: string) {
  router.push(`/v2/settings/providers/edit/${providerId}`)
}
</script>

<template>
  <div :class="['h-full w-full flex flex-col gap-2']">
    <h2 :class="['mb-1 flex justify-between', 'text-neutral-900 dark:text-neutral-100']">
      {{ t('settings.pages.providers.custom.catalog-title') }}
    </h2>
    <Splitpanes :class="['flex gap-0.8 bg-transparent']">
      <Pane :min-size="10" :size="paneDatasourceListSize">
        <PaneArea
          :class="[
            'flex flex-col gap-2',
            'bg-neutral-50/90 dark:bg-neutral-900/90',
          ]"
        >
          <div :class="['relative h-full w-full flex flex-col gap-2']">
            <div :class="['relative flex flex-1 flex-col gap-2']">
              <div :class="['flex flex-row items-center gap-2']">
                <Input :placeholder="t('settings.pages.providers.custom.search-configured')" variant="primary-dimmed" />

                <DropdownMenuRoot>
                  <DropdownMenuTrigger as-child :aria-label="t('settings.pages.providers.custom.add')">
                    <Button size="sm">
                      <div :class="['i-ph:plus-light']" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuPortal>
                    <DropdownMenuContent
                      :class="[
                        'bg-white', 'dark:bg-neutral-800/90',
                        'shadow-md', 'dark:shadow-lg',
                        'backdrop-blur-md',
                        'will-change-[opacity,transform] min-w-[300px] rounded-xl p-2 outline-none',
                        'data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade data-[side=right]:animate-slideLeftAndFade data-[side=top]:animate-slideDownAndFade',
                      ]"
                      :side-offset="8"
                      align="start"
                    >
                      <Input v-model="availableProviderSearchQuery" :placeholder="t('settings.pages.providers.custom.search-available')" class="mb-2" variant="primary-dimmed" />
                      <div :class="['max-h-50dvh flex flex-col gap-1 overflow-y-auto']">
                        <div v-for="(provider) in availableProvidersFiltered" :key="provider.id" @click="() => handleAdd(provider.id)">
                          <div
                            :class="[
                              'hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80',
                              'transition-all duration-100 ease-out',
                              'flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-sm',
                            ]"
                          >
                            <div class="relative w-4">
                              <div :class="[provider.iconColor || provider.icon, 'absolute left-50% top-50% -translate-x-1/2 -translate-y-1/2']" />
                            </div>
                            <div>{{ provider.nameLocalized }}</div>
                          </div>
                        </div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </div>

              <div v-if="listedProviders.length === 0" :class="['text-neutral-500 <lg:px-4', 'flex flex-1 flex-col items-center justify-center gap-2']">
                <div :class="['i-ph:rectangle-dashed-light text-4xl']" />
                <div :class="['flex items-center justify-center gap-2']">
                  <span>{{ t('settings.pages.providers.custom.empty') }}</span>
                </div>
              </div>

              <div v-auto-animate :class="['h-fit max-h-[calc(100dvh-12.5rem)]', 'flex flex-col gap-0.5 overflow-y-scroll']">
                <div
                  v-for="provider in listedProviders"
                  :key="provider.id"
                  @click="() => handleClick(provider.id)"
                >
                  <div
                    :class="[
                      'hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80',
                      'transition-all duration-100 ease-out',
                      'flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-sm',
                    ]"
                  >
                    <div class="relative w-4">
                      <div :class="[provider.icon, 'absolute left-50% top-50% -translate-x-1/2 -translate-y-1/2']" />
                    </div>
                    <div>{{ provider.localizedName }} ({{ t(`settings.pages.providers.categories.${provider.category}.title`) }})</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PaneArea>
      </Pane>
      <Pane :min-size="20" :size="paneDatasourceEditSize">
        <PaneArea :class="['flex flex-col gap-2']">
          <RouterView />
        </PaneArea>
      </Pane>
    </Splitpanes>
  </div>
</template>
