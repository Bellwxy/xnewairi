<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { useI18n } from 'vue-i18n'

interface Props {
  modelValue: boolean
  /** Labels of the fields that another source changed while the editor was open. */
  fields: string[]
}

defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'keepDraft': []
  'keepLatest': []
}>()

const { t } = useI18n()

function choose(event: 'keepDraft' | 'keepLatest') {
  emit('update:modelValue', false)
  if (event === 'keepDraft')
    emit('keepDraft')
  else
    emit('keepLatest')
}
</script>

<template>
  <AlertDialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay
        :class="[
          'fixed inset-0 z-100',
          'bg-black/50',
          'data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn',
        ]"
      />
      <AlertDialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-100 w-[92vw] max-w-md',
          'border border-neutral-200 rounded-xl bg-white p-6 shadow-xl',
          'dark:border-neutral-700 dark:bg-neutral-800',
          '-translate-x-1/2 -translate-y-1/2',
          'data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow',
        ]"
        @interact-outside.prevent
      >
        <AlertDialogTitle :class="['mb-3', 'text-xl font-normal']">
          {{ t('settings.pages.card.conflict.title') }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mb-6', 'text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.card.conflict.message', { fields: fields.join(', ') }) }}
        </AlertDialogDescription>

        <div :class="['flex flex-row flex-wrap justify-end gap-3']">
          <AlertDialogCancel as-child>
            <Button
              :label="t('settings.pages.card.conflict.keep_latest')"
              @click="choose('keepLatest')"
            />
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <Button
              :label="t('settings.pages.card.conflict.keep_mine')"
              color="primary"
              variant="primary"
              @click="choose('keepDraft')"
            />
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
