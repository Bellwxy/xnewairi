<script setup lang="ts">
import type { GeneratedCharacterFields } from '@proj-airi/stage-ui/services/character-card-generation'

import { errorMessageFrom } from '@moeru/std'
import { useCharacterCardGeneration } from '@proj-airi/stage-ui/composables/use-character-card-generation'
import { applyGeneratedFields } from '@proj-airi/stage-ui/services/character-card-generation'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Button, FieldInput } from '@proj-airi/ui'
import { computed, onBeforeUnmount, ref, shallowRef, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const props = defineProps<{
  cardId: string
}>()

const { t, locale } = useI18n()
const cardStore = useAiriCardStore()
const { generate } = useCharacterCardGeneration()

const card = computed(() => cardStore.getCard(props.cardId))
const summary = ref(card.value?.extensions.airi.generation?.summary ?? '')
const isGenerating = ref(false)
const errorMessage = ref('')
/**
 * A generated result that waits for the user to compare it with the card.
 * `undefined` means no result waits. The card changes only when the user replaces it.
 */
const pending = shallowRef<{ fields: GeneratedCharacterFields, summary: string }>()
/** Closing the panel cancels a running generation, so a late reply never shows a result. */
const lifetime = new AbortController()

const canRegenerate = computed(() => summary.value.trim().length > 0 && !isGenerating.value)

const comparedFields = computed(() => {
  const current = card.value
  const generated = pending.value?.fields
  if (!current || !generated)
    return []
  return [
    { key: 'description', label: t('settings.pages.card.description_label'), current: current.description, generated: generated.description },
    { key: 'personality', label: t('settings.pages.card.personality'), current: current.personality, generated: generated.personality },
    { key: 'scenario', label: t('settings.pages.card.scenario'), current: current.scenario, generated: generated.scenario },
    { key: 'greeting', label: t('settings.pages.card.generation.greeting'), current: current.greetings?.[0], generated: generated.greeting },
  ]
})

async function regenerate() {
  const current = card.value
  const characterSummary = summary.value.trim()
  if (!current || !characterSummary)
    return

  isGenerating.value = true
  errorMessage.value = ''
  pending.value = undefined
  try {
    const fields = await generate(
      cardStore.getModules(props.cardId).consciousness,
      { name: current.name, summary: characterSummary, language: locale.value },
      lifetime.signal,
    )
    pending.value = { fields, summary: characterSummary }
  }
  catch (error) {
    if (lifetime.signal.aborted)
      return
    // Regeneration has no fallback text. The card keeps its content, and the user sees why.
    errorMessage.value = t('settings.pages.card.generation.failed', { error: errorMessageFrom(error) ?? String(error) })
  }
  finally {
    isGenerating.value = false
  }
}

async function replaceCard() {
  const result = pending.value
  const latest = cardStore.getCard(props.cardId)
  if (!result || !latest)
    return

  // Merge into the latest stored card, not a copy from the start of generation, so edits made meanwhile survive.
  // The store action can run in another window, so its argument must be a plain object.
  await cardStore.updateCard(props.cardId, applyGeneratedFields(structuredClone(toRaw(latest)), result.fields, result.summary))
  pending.value = undefined
  toast(t('settings.pages.card.generation.applied', { name: latest.name }))
}

onBeforeUnmount(() => {
  lifetime.abort(new Error('The regeneration panel closed'))
})
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.card.generation.description') }}
    </p>

    <FieldInput
      v-model="summary"
      :label="t('settings.pages.card.generation.summary-label')"
      :placeholder="t('settings.pages.card.generation.summary-placeholder')"
      :disabled="isGenerating"
    />

    <div :class="['flex flex-row justify-end']">
      <Button
        icon="i-solar:magic-stick-3-bold-duotone"
        :label="isGenerating ? t('settings.pages.card.generation.generating') : t('settings.pages.card.generation.regenerate')"
        :loading="isGenerating"
        :disabled="!canRegenerate"
        @click="regenerate"
      />
    </div>

    <p v-if="errorMessage" role="alert" :class="['text-sm', 'text-red-500 dark:text-red-400']">
      {{ errorMessage }}
    </p>

    <div v-if="pending" :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-1']">
        <h3 :class="['text-base font-medium', 'text-neutral-800 dark:text-neutral-100']">
          {{ t('settings.pages.card.generation.preview-title') }}
        </h3>
        <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.card.generation.preview-description') }}
        </p>
      </div>

      <div :class="['flex flex-col gap-4', 'max-h-96 overflow-auto pr-1']">
        <section v-for="field in comparedFields" :key="field.key" :class="['flex flex-col gap-2']">
          <h4 :class="['text-sm font-medium', 'text-neutral-500 dark:text-neutral-400']">
            {{ field.label }}
          </h4>
          <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-2']">
            <div :class="['flex flex-col gap-1 rounded-lg p-3', 'border border-neutral-200/50 bg-white/60 dark:border-neutral-700/30 dark:bg-black/30']">
              <span :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">
                {{ t('settings.pages.card.generation.current') }}
              </span>
              <p :class="['whitespace-pre-line text-sm', 'text-neutral-600 dark:text-neutral-300']">
                {{ field.current || '—' }}
              </p>
            </div>
            <div :class="['flex flex-col gap-1 rounded-lg p-3', 'border border-primary-500/30 bg-primary-500/5']">
              <span :class="['text-xs', 'text-primary-600 dark:text-primary-400']">
                {{ t('settings.pages.card.generation.generated') }}
              </span>
              <p :class="['whitespace-pre-line text-sm', 'text-neutral-700 dark:text-neutral-200']">
                {{ field.generated }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div :class="['flex flex-row flex-wrap justify-end gap-2']">
        <Button
          :label="t('settings.pages.card.generation.discard')"
          @click="pending = undefined"
        />
        <Button
          variant="primary"
          :label="t('settings.pages.card.generation.apply')"
          @click="replaceCard"
        />
      </div>
    </div>
  </div>
</template>
