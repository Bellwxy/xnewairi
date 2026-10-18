<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import type { OnboardingStepNextHandler, OnboardingStepPrevHandler } from './types'

import { errorMessageFrom } from '@moeru/std'
import { Button, FieldCheckbox, IconButton, ScrollableArea } from '@proj-airi/ui'
import { generateSpeech } from '@xsai/generate-speech'
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { builtInVoice, useBuiltInVoice } from '../../../../composables/use-built-in-voice'
import { availableSherpawModels } from '../../../../libs/providers/providers/sherpaw/model-resources'
import { useHearingStore } from '../../../../stores/modules/hearing'
import { useProviderStore } from '../../../../stores/providers/provider'

const props = defineProps<{
  onNext: OnboardingStepNextHandler
  onPrevious: OnboardingStepPrevHandler
}>()
const { t } = useI18n()

const providersStore = useProviderStore()
const voice = useBuiltInVoice()
const { activeTranscriptionProvider, activeTranscriptionModel } = storeToRefs(useHearingStore())

/** The bundled recognizer. */
const hearingProviderId = 'sherpaw-transcription'

// The host decides what the package contains. Web has neither feature, so the step finishes at once.
const speechAvailable = ref(false)
const hearingAvailable = ref(false)
const speechEnabled = ref(true)
const hearingEnabled = ref(true)
const isApplying = ref(false)
const isPreviewing = ref(false)
const previewError = ref('')
let previewUrl = ''
const audio = new Audio()

async function preview() {
  isPreviewing.value = true
  previewError.value = ''
  try {
    const provider = await providersStore.getProviderInstance<SpeechProvider>(builtInVoice.provider)
    const wav = await generateSpeech({
      ...provider.speech(builtInVoice.model),
      input: t('settings.dialogs.onboarding.voice.preview-text'),
      voice: builtInVoice.voice_id,
    })
    URL.revokeObjectURL(previewUrl)
    previewUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    audio.src = previewUrl
    await audio.play()
  }
  catch (error) {
    previewError.value = t('settings.dialogs.onboarding.voice.preview-failed', { error: errorMessageFrom(error) ?? 'unknown error' })
  }
  finally {
    isPreviewing.value = false
  }
}

async function enableHearing() {
  // The provider config picks the recognizer for the interface language and the device, so the Hearing model stays empty.
  await providersStore.initializeProvider(hearingProviderId)
  await providersStore.forceProviderConfigured(hearingProviderId)
  activeTranscriptionProvider.value = hearingProviderId
  activeTranscriptionModel.value = ''
}

async function finish() {
  isApplying.value = true
  try {
    if (speechAvailable.value && speechEnabled.value)
      await voice.enable()
    if (hearingAvailable.value && hearingEnabled.value)
      await enableHearing()
    await props.onNext()
  }
  finally {
    isApplying.value = false
  }
}

onMounted(async () => {
  speechAvailable.value = await voice.isAvailable()
  // The host lists only bundled recognizers.
  hearingAvailable.value = availableSherpawModels.length > 0
  if (!speechAvailable.value && !hearingAvailable.value)
    await props.onNext()
})

onBeforeUnmount(() => {
  audio.pause()
  URL.revokeObjectURL(previewUrl)
})
</script>

<template>
  <div :class="['h-full flex flex-col gap-4']">
    <div :class="['sticky top-0 z-100', 'flex flex-shrink-0 items-center gap-2']">
      <IconButton
        icon="i-solar:alt-arrow-left-line-duotone"
        :aria-label="t('settings.dialogs.onboarding.back')"
        :title="t('settings.dialogs.onboarding.back')"
        :disabled="isApplying"
        :class="['h-8 w-8']"
        @click="props.onPrevious"
      />
      <h2 :class="['min-w-0 flex-1 text-xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
        {{ t('settings.dialogs.onboarding.voice.title') }}
      </h2>
    </div>

    <ScrollableArea :class="['min-h-0 flex-1']">
      <div :class="['flex flex-col gap-6']">
        <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.dialogs.onboarding.voice.description') }}
        </p>

        <div v-if="speechAvailable" :class="['flex flex-col gap-2']">
          <FieldCheckbox
            v-model="speechEnabled"
            :label="t('settings.dialogs.onboarding.voice.speech-label')"
            :description="t('settings.dialogs.onboarding.voice.speech-description')"
            :disabled="isApplying"
          />
          <Button
            size="sm"
            icon="i-solar:play-bold"
            :label="t('settings.dialogs.onboarding.voice.preview')"
            :loading="isPreviewing"
            :disabled="isPreviewing || isApplying"
            :class="['self-start']"
            @click="preview"
          />
          <p v-if="previewError" :class="['text-xs', 'text-red-500 dark:text-red-400']">
            {{ previewError }}
          </p>
        </div>

        <FieldCheckbox
          v-if="hearingAvailable"
          v-model="hearingEnabled"
          :label="t('settings.dialogs.onboarding.voice.hearing-label')"
          :description="t('settings.dialogs.onboarding.voice.hearing-description')"
          :disabled="isApplying"
        />
      </div>
    </ScrollableArea>

    <div :class="['flex flex-shrink-0 flex-col gap-2']">
      <Button
        color="primary"
        variant="primary"
        :label="t('settings.dialogs.onboarding.voice.finish')"
        :loading="isApplying"
        :disabled="isApplying"
        @click="finish"
      />
      <Button
        :label="t('settings.dialogs.onboarding.voice.skip')"
        :disabled="isApplying"
        @click="props.onNext()"
      />
    </div>
  </div>
</template>
