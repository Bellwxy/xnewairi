<script setup lang="ts">
import type { ProviderMetadata } from '../../../../libs/providers/metadata'
import type { OnboardingStepNextHandler, OnboardingStepPrevHandler } from './types'

import { errorMessageFrom } from '@moeru/std'
import { Button, Callout, FieldCheckbox, FieldInput, IconButton, ScrollableArea } from '@proj-airi/ui'
import { computedAsync } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'
import { Alert } from '../../../misc'

const props = defineProps<{
  selectedProviderId: string
  selectedProvider: ProviderMetadata | null
  onNext: OnboardingStepNextHandler
  onPrevious: OnboardingStepPrevHandler
}>()
const { t } = useI18n()
const providersStore = useProviderStore()
const providerConfigStore = useProviderConfigStore()
const apiKey = ref('')
const baseUrl = ref('')
const enableChatCheck = ref(true)
const validation = ref<'unchecked' | 'pending' | 'succeed' | 'failed'>('unchecked')
const validationError = ref<string>()

// Returning from model selection restores the leader-owned saved configuration.
watch(() => props.selectedProvider?.id, (providerId) => {
  if (!providerId)
    return
  const savedConfig = providerConfigStore.getProviderConfig(providerId)
  baseUrl.value = typeof savedConfig?.baseUrl === 'string' ? savedConfig.baseUrl : ''
  apiKey.value = typeof savedConfig?.apiKey === 'string' ? savedConfig.apiKey : ''
  validation.value = 'unchecked'
  validationError.value = undefined
  enableChatCheck.value = true
}, { immediate: true })

watch([apiKey, baseUrl], () => {
  if (validation.value === 'failed' || validation.value === 'succeed') {
    validation.value = 'unchecked'
    validationError.value = undefined
  }
})

const showChatCheckOption = computedAsync(
  async () => props.selectedProvider
    ? await providersStore.hasManualProviderValidators(props.selectedProvider.id)
    : false,
  false,
)
const canProceed = computed(() => !!props.selectedProvider && !!apiKey.value.trim() && !!baseUrl.value.trim() && validation.value !== 'pending')
const primaryActionLabel = computed(() => t(validation.value === 'failed' ? 'settings.dialogs.onboarding.retry' : 'settings.dialogs.onboarding.next'))

async function handleNext() {
  if (!canProceed.value)
    return
  validation.value = 'pending'
  validationError.value = undefined
  try {
    const result = await providersStore.validateProviderConfig(props.selectedProviderId, {
      apiKey: apiKey.value.trim(),
      baseUrl: baseUrl.value.trim(),
    }, { skipChatPingCheck: !enableChatCheck.value })
    validation.value = result.valid ? 'succeed' : 'failed'
    if (!result.valid) {
      validationError.value = result.reason
      return
    }
  }
  catch (error) {
    validation.value = 'failed'
    validationError.value = t('settings.dialogs.onboarding.validationError', {
      error: errorMessageFrom(error) ?? 'Unknown error',
    })
    return
  }
  await saveConfiguration()
}

async function saveConfiguration() {
  if (!canProceed.value)
    return
  await props.onNext({ apiKey: apiKey.value, baseUrl: baseUrl.value, accountId: '' })
}
</script>

<template>
  <div :class="['h-full flex flex-col gap-4']">
    <div :class="['sticky top-0 z-100', 'flex flex-shrink-0 items-center gap-2']">
      <IconButton
        icon="i-solar:alt-arrow-left-line-duotone"
        :aria-label="t('settings.dialogs.onboarding.back')"
        :title="t('settings.dialogs.onboarding.back')"
        :class="['h-8 w-8']"
        @click="props.onPrevious"
      />
      <h2 :class="['min-w-0 flex-1 text-xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
        {{ t('settings.dialogs.onboarding.configureProvider', { provider: props.selectedProvider?.localizedName }) }}
      </h2>
    </div>
    <ScrollableArea v-if="props.selectedProvider" :class="['min-h-0 flex-1']">
      <div :class="['space-y-4']">
        <Callout :label="t('settings.dialogs.onboarding.credentialsSafeLabel')" theme="violet">
          {{ t('settings.dialogs.onboarding.credentialsSafeLocal') }}
        </Callout>
        <FieldInput
          v-model="apiKey"
          type="password"
          :label="t('settings.dialogs.onboarding.apiKey')"
          :description="t('settings.pages.providers.custom.api-key-description')"
          :placeholder="t('settings.dialogs.onboarding.apiKey')"
          required
        />
        <FieldInput
          v-model="baseUrl"
          type="url"
          :label="t('settings.dialogs.onboarding.baseUrl')"
          :description="t('settings.pages.providers.custom.base-url-description')"
          placeholder="https://api.example.com/v1/"
          required
        />
        <FieldCheckbox
          v-if="showChatCheckOption"
          v-model="enableChatCheck"
          :label="t('settings.dialogs.onboarding.enableChatCheck')"
          placement="left"
        />
        <Alert v-if="validation === 'failed'" type="error">
          <template #title>
            <div :class="['w-full flex flex-wrap items-center justify-between gap-2']">
              <span>{{ t('settings.dialogs.onboarding.validationFailed') }}</span>
              <Button
                size="sm"
                :label="t('settings.pages.providers.common.continueAnyway')"
                :disabled="!canProceed"
                @click="saveConfiguration"
              />
            </div>
          </template>
          <template v-if="validationError" #content>
            <pre :class="['whitespace-pre-wrap break-all']">{{ validationError }}</pre>
          </template>
        </Alert>
      </div>
    </ScrollableArea>
    <Button :label="primaryActionLabel" :loading="validation === 'pending'" :disabled="!canProceed" @click="handleNext" />
  </div>
</template>
