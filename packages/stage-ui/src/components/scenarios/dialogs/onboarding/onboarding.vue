<script setup lang="ts">
import type {
  OnboardingStep,
  OnboardingStepGuard,
  OnboardingStepNextHandler,
  OnboardingStepPrevHandler,
  ProviderConfigData,
} from './types'

import { brand } from '@proj-airi/stage-shared/brand'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import StepCharacter from './step-character.vue'
import StepProviderConfiguration from './step-provider-configuration.vue'
import StepVoice from './step-voice.vue'
import StepWelcome from './step-welcome.vue'

import { useAnalytics } from '../../../../composables/use-analytics'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'

interface Emits {
  (e: 'configured'): void
  (e: 'skipped'): void
}

const props = withDefaults(defineProps<{
  extraSteps?: OnboardingStep[]
}>(), {
  extraSteps: () => [],
})
const emit = defineEmits<Emits>()
const step = ref(0)
const direction = ref<'next' | 'previous'>('next')
const pendingProviderConfig = ref<ProviderConfigData | null>(null)
/** Set when onboarding found no chat model. The configuration step shows it with a retry and does not continue. */
const modelCatalogFailed = ref(false)
const { trackOnboardingCompleted, trackOnboardingStarted, trackOnboardingStepCompleted } = useAnalytics()

const providersStore = useProviderStore()

const providerStore = useProviderConfigStore()
const { allChatProvidersMetadata } = storeToRefs(providersStore)
const cardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()
const {
  activeProvider,
  activeModel,
} = storeToRefs(consciousnessStore)

const selectedProviderId = 'openai-compatible'
const selectedProvider = computed(() => {
  return allChatProvidersMetadata.value.find(p => p.id === selectedProviderId) ?? null
})

const requestPreviousStep: OnboardingStepPrevHandler = () => {
  return navigatePrevious()
}

const requestNextStep: OnboardingStepNextHandler = async (configData?: ProviderConfigData) => {
  pendingProviderConfig.value = configData ?? null
  await navigateNext()
}

/**
 * Selects the chat model, because onboarding has no model step.
 * Returns false when no model is available, so the configuration step keeps the user and offers a retry.
 */
async function selectChatModel(providerId: string) {
  // The brand fixes the model, so onboarding needs no catalog request.
  if (brand.inferenceModel) {
    activeModel.value = brand.inferenceModel
    return true
  }

  // The leader loads the catalog. Its result arrives before the replicated runtime state reaches this window.
  // A failed request also returns an empty catalog.
  let firstListedModel: string | undefined
  try {
    const catalog = await providersStore.fetchModelsForProvider(providerId)
    firstListedModel = catalog.models[0]?.id
  }
  catch (err) {
    console.error('[onboarding] Failed to load models for provider:', err)
  }

  if (!firstListedModel)
    return false
  activeModel.value = firstListedModel
  return true
}

async function saveProviderConfiguration(data: ProviderConfigData) {
  if (!selectedProvider.value)
    return false

  const config: Record<string, unknown> = {}

  if (data.apiKey)
    config.apiKey = data.apiKey.trim()
  if (data.baseUrl)
    config.baseUrl = data.baseUrl.trim()
  if (data.accountId)
    config.accountId = data.accountId.trim()
  if (data.customFields) {
    for (const [key, value] of Object.entries(data.customFields)) {
      if (value)
        config[key] = value.trim()
    }
  }

  // Provider configuration is leader-owned synchronized state. Route the save
  // through synced actions so the leader persists it and replicates it back;
  // the `configs` computed projection discards direct writes on recompute.
  await providersStore.initializeProvider(selectedProvider.value.id)
  await providerStore.patchProviderConfig(selectedProvider.value.id, config)
  await providersStore.forceProviderConfigured(selectedProvider.value.id)

  activeProvider.value = selectedProvider.value.id

  modelCatalogFailed.value = !await selectChatModel(selectedProvider.value.id)
  return !modelCatalogFailed.value
}

const allSteps = computed<OnboardingStep[]>(() => {
  const coreSteps: OnboardingStep[] = [
    {
      id: 'welcome',
      component: StepWelcome,
    },
    {
      id: 'provider-configuration',
      component: StepProviderConfiguration,
      props: () => ({
        selectedProviderId,
        selectedProvider: selectedProvider.value,
        modelCatalogFailed: modelCatalogFailed.value,
      }),
      beforeNext: async () => {
        if (!pendingProviderConfig.value)
          return false

        const saved = await saveProviderConfiguration(pendingProviderConfig.value)
        pendingProviderConfig.value = null
        return saved
      },
    },
    ...props.extraSteps.map(step => ({
      ...step,
      props: () => ({
        ...step.props?.(),
      }),
    })),
    // Generation needs the chat model that the configuration step selected.
    {
      id: 'character',
      component: StepCharacter,
    },
    // The voice belongs to the active card, so this step comes after the card exists.
    {
      id: 'voice',
      component: StepVoice,
    },
  ]

  return coreSteps
})

const currentStep = computed(() => allSteps.value[step.value] ?? null)
const isLastStep = computed(() => step.value === allSteps.value.length - 1)
const currentStepProps = computed(() => currentStep.value?.props?.() ?? {})

async function handleSave() {
  // A chat reads the character selection, which inherits the card defaults. Store the selection whichever steps the user skipped.
  await cardStore.updateDefaultConsciousness({ provider: activeProvider.value, model: activeModel.value })
  trackOnboardingStepCompleted(currentStep.value?.id ?? 'unknown')
  trackOnboardingCompleted({
    selected_provider_type: 'custom',
    selected_provider_id: selectedProviderId,
    selected_use_case: 'unknown',
  })
  emit('configured')
}

async function canPassGuard(guard?: OnboardingStepGuard) {
  if (!guard)
    return true

  return await guard()
}

async function navigateNext() {
  if (!currentStep.value)
    return

  if (!(await canPassGuard(currentStep.value.beforeNext)))
    return

  if (isLastStep.value) {
    await handleSave()
    return
  }

  trackOnboardingStepCompleted(currentStep.value.id)
  direction.value = 'next'
  step.value++
}

async function navigatePrevious() {
  if (!currentStep.value || step.value <= 0)
    return

  if (!(await canPassGuard(currentStep.value.beforePrev)))
    return

  direction.value = 'previous'
  step.value--
}

onMounted(() => {
  trackOnboardingStarted({ entry: 'app_start' })
})
</script>

<template>
  <div :class="['onboarding-step-container', 'min-h-0 flex flex-1 flex-col']">
    <Transition :name="direction === 'next' ? 'slide-next' : 'slide-prev'" mode="out-in">
      <component
        :is="currentStep.component"
        v-if="currentStep"
        :key="currentStep.id"
        class="flex flex-1 flex-col"
        v-bind="currentStepProps"
        :on-next="requestNextStep"
        :on-previous="requestPreviousStep"
      />
    </Transition>
  </div>
</template>

<style scoped>
.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  will-change: transform, opacity;
}

.slide-next-enter-active {
  animation: onboarding-slide-next-in 0.2s ease-in-out both;
}

.slide-next-leave-active {
  animation: onboarding-slide-next-out 0.2s ease-in-out both;
}

.slide-prev-enter-active {
  animation: onboarding-slide-prev-in 0.2s ease-in-out both;
}

.slide-prev-leave-active {
  animation: onboarding-slide-prev-out 0.2s ease-in-out both;
}

@keyframes onboarding-slide-next-in {
  from {
    transform: translateX(2rem);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes onboarding-slide-next-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }

  to {
    transform: translateX(-2rem);
    opacity: 0;
  }
}

@keyframes onboarding-slide-prev-in {
  from {
    transform: translateX(-2rem);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes onboarding-slide-prev-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }

  to {
    transform: translateX(2rem);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .slide-next-enter-active,
  .slide-next-leave-active,
  .slide-prev-enter-active,
  .slide-prev-leave-active {
    animation-duration: 1ms;
  }
}
</style>
