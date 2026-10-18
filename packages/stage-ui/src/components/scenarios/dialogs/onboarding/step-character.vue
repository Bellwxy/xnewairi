<script setup lang="ts">
import type { Card } from '@proj-airi/ccc'

import type { CharacterPresetId, GeneratedCharacterFields } from '../../../../services/character-card-generation'
import type { AiriExtension } from '../../../../types/airiCard'
import type { OnboardingStepNextHandler, OnboardingStepPrevHandler } from './types'

import { errorMessageFrom } from '@moeru/std'
import { Button, FieldInput, IconButton, ScrollableArea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCharacterCardGeneration } from '../../../../composables/use-character-card-generation'
import { characterPresetIds } from '../../../../services/character-card-generation'
import { isLive2DModel, useDisplayModelsStore } from '../../../../stores/display-models'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useSettingsStageModel } from '../../../../stores/settings/stage-model'
import { RadioCardSimple } from '../../../menu'

const props = defineProps<{
  onNext: OnboardingStepNextHandler
  onPrevious: OnboardingStepPrevHandler
}>()
const { t, locale } = useI18n()

const cardStore = useAiriCardStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const displayModelsStore = useDisplayModelsStore()
const { displayModels } = storeToRefs(displayModelsStore)
/** The product renders Live2D only. Models from other formats stay out of the choice. */
const live2dModels = computed(() => displayModels.value.filter(isLive2DModel))
const { stageModelSelected } = storeToRefs(useSettingsStageModel())
const { generate } = useCharacterCardGeneration()

const name = ref('')
const summary = ref('')
/**
 * The preset whose example the user chose last, `gentle` until the user chooses one.
 * Its example fills an empty summary, and its personality template is the fallback when generation fails.
 */
const presetId = ref<CharacterPresetId>('gentle')
const displayModelId = ref(stageModelSelected.value)
const isCreating = ref(false)
/** Closing the step cancels a running generation. A cancelled generation creates no card. */
const lifetime = new AbortController()

const canCreate = computed(() => name.value.trim().length > 0 && !isCreating.value)

function choosePreset(id: CharacterPresetId) {
  presetId.value = id
  summary.value = t(`settings.pages.card.presets.${id}.summary`)
}

async function writeFields(characterName: string, characterSummary: string): Promise<GeneratedCharacterFields> {
  try {
    return await generate(
      { provider: activeProvider.value, model: activeModel.value },
      { name: characterName, summary: characterSummary, language: locale.value },
      lifetime.signal,
    )
  }
  catch (error) {
    // Onboarding must finish without a working model. The preset template gives a usable card,
    // and the user can regenerate it later from the card page.
    console.warn('[onboarding] Character generation failed, so the preset template is used:', errorMessageFrom(error))
    return {
      description: t('settings.pages.card.generation.fallback-description', { name: characterName, summary: characterSummary }),
      personality: t(`settings.pages.card.presets.${presetId.value}.personality`),
      scenario: '',
      greeting: '',
    }
  }
}

async function createCharacter() {
  const characterName = name.value.trim()
  if (!characterName)
    return

  const characterSummary = summary.value.trim() || t(`settings.pages.card.presets.${presetId.value}.summary`)
  isCreating.value = true
  try {
    const fields = await writeFields(characterName, characterSummary)
    if (lifetime.signal.aborted)
      return

    const airi: AiriExtension = {
      // Empty module selections inherit the chat model that onboarding just selected.
      modules: {
        consciousness: { provider: '', model: '' },
        speech: { provider: '', model: '', voice_id: '' },
        displayModelId: displayModelId.value,
      },
      agents: {},
      generation: { summary: characterSummary },
    }
    const card: Card = {
      name: characterName,
      version: '1.0.0',
      description: fields.description,
      personality: fields.personality,
      scenario: fields.scenario,
      greetings: fields.greeting ? [fields.greeting] : [],
      extensions: { airi },
    }

    const cardId = await cardStore.addCard(card, 'generated')
    await cardStore.activateCard(cardId)
    await props.onNext()
  }
  finally {
    isCreating.value = false
  }
}

onMounted(async () => {
  // The onboarding window of the desktop app can open before any page loads the models.
  if (displayModels.value.length === 0)
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
  // The current stage model can be another format. The character then starts with the first Live2D model.
  if (!live2dModels.value.some(model => model.id === displayModelId.value))
    displayModelId.value = live2dModels.value[0]?.id ?? displayModelId.value
})

onBeforeUnmount(() => {
  lifetime.abort(new Error('The character step closed'))
})
</script>

<template>
  <div :class="['h-full flex flex-col gap-4']">
    <div :class="['sticky top-0 z-100', 'flex flex-shrink-0 items-center gap-2']">
      <IconButton
        icon="i-solar:alt-arrow-left-line-duotone"
        :aria-label="t('settings.dialogs.onboarding.back')"
        :title="t('settings.dialogs.onboarding.back')"
        :disabled="isCreating"
        :class="['h-8 w-8']"
        @click="props.onPrevious"
      />
      <h2 :class="['min-w-0 flex-1 text-xl font-semibold', 'text-neutral-800 dark:text-neutral-100']">
        {{ t('settings.dialogs.onboarding.character.title') }}
      </h2>
    </div>

    <ScrollableArea :class="['min-h-0 flex-1']">
      <div :class="['flex flex-col gap-6']">
        <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.dialogs.onboarding.character.description') }}
        </p>

        <FieldInput
          v-model="name"
          :label="t('settings.dialogs.onboarding.character.name-label')"
          :placeholder="t('settings.dialogs.onboarding.character.name-placeholder')"
          :disabled="isCreating"
          required
        />

        <div :class="['flex flex-col gap-2']">
          <FieldInput
            v-model="summary"
            :label="t('settings.dialogs.onboarding.character.summary-label')"
            :description="t('settings.dialogs.onboarding.character.summary-description')"
            :placeholder="t('settings.dialogs.onboarding.character.summary-placeholder')"
            :disabled="isCreating"
          />
          <div :class="['flex flex-wrap gap-2']">
            <Button
              v-for="id in characterPresetIds"
              :key="id"
              size="sm"
              :label="t(`settings.pages.card.presets.${id}.label`)"
              :disabled="isCreating"
              @click="choosePreset(id)"
            />
          </div>
        </div>

        <div v-if="live2dModels.length > 0" :class="['flex flex-col gap-2']">
          <div :class="['flex flex-col gap-1']">
            <span :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.dialogs.onboarding.character.model-label') }}
            </span>
            <span :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.dialogs.onboarding.character.model-description') }}
            </span>
          </div>
          <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-2']">
            <RadioCardSimple
              v-for="model in live2dModels"
              :id="`onboarding-character-model-${model.id}`"
              :key="model.id"
              v-model="displayModelId"
              name="onboarding-character-model"
              :value="model.id"
              :title="model.name"
            >
              <template v-if="model.previewImage" #topRight>
                <img
                  :src="model.previewImage"
                  :alt="model.name"
                  :class="['h-12 w-12', 'rounded-lg object-cover']"
                >
              </template>
            </RadioCardSimple>
          </div>
        </div>
      </div>
    </ScrollableArea>

    <div :class="['flex flex-shrink-0 flex-col gap-2']">
      <Button
        color="primary"
        variant="primary"
        :label="isCreating ? t('settings.dialogs.onboarding.character.generating') : t('settings.dialogs.onboarding.character.create')"
        :loading="isCreating"
        :disabled="!canCreate"
        @click="createCharacter"
      />
      <Button
        :label="t('settings.dialogs.onboarding.character.skip')"
        :disabled="isCreating"
        @click="props.onNext()"
      />
    </div>
  </div>
</template>
