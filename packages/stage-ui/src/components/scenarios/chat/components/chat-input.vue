<script setup lang="ts">
import type { ChatToolReference } from '../../../../types/chat'

import { BasicButton } from '@proj-airi/ui'
import { nextTick, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import VoiceInputButton from './voice-input-button.vue'

defineProps<{
  sessionId: string
  replyToMessageId?: string
  tools?: ChatToolReference[]
  /** Pending recordings stay visible beside the host's attachments in either input mode. */
  attachmentElement: HTMLElement | null
}>()
const emit = defineEmits<{
  sent: []
  recordingChange: [active: boolean]
  pendingChange: [pending: boolean]
  submit: []
  configure: [route: '/settings/modules/hearing' | '/settings/modules/hearing/transcriber']
}>()
const draft = defineModel<string>({ required: true })
const { t } = useI18n()
const root = useTemplateRef<HTMLDivElement>('root')
const voiceButton = useTemplateRef<InstanceType<typeof VoiceInputButton>>('voice-button')
const voiceStatus = useTemplateRef<HTMLDivElement>('voice-status')
// Mode selection is local to this composer. Selecting Voice does not start the microphone.
const voiceMode = shallowRef(false)
const recording = shallowRef(false)

function selectMode(voice: boolean) {
  if (voiceMode.value === voice)
    return
  voiceMode.value = voice
  if (!voice)
    focusText()
}

/** Returns to the draft without sending the active recording, then focuses the text input. */
function focusText() {
  voiceMode.value = false
  void voiceButton.value?.cancel()
  void nextTick(() => root.value?.querySelector('textarea')?.focus())
}

function onRecordingChange(active: boolean) {
  recording.value = active
  emit('recordingChange', active)
}

/** Sends the pending recording with the host's draft. The voice control retains failed submissions for retry. */
async function sendPending(text: string) {
  return await voiceButton.value?.sendPending(text) ?? 'none'
}

defineExpose({ focusText, sendPending })

const modeButtonClasses = [
  'h-11 min-w-0 flex-1 rounded-md px-3 text-sm',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500',
  'transition-colors duration-150 motion-reduce:transition-none',
]
</script>

<template>
  <div ref="root" data-testid="chat-input" :class="['min-w-0 w-full']">
    <div :class="['px-2 py-1']">
      <div
        role="group"
        :aria-label="t('stage.chat.input-mode.label')"
        :class="['grid max-w-64 grid-cols-2 gap-1 rounded-lg bg-neutral-200/60 p-1 dark:bg-neutral-800/80']"
      >
        <BasicButton
          type="button"
          size="unset"
          data-testid="chat-input-mode-text"
          :aria-pressed="!voiceMode"
          :class="[
            modeButtonClasses,
            !voiceMode ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-200' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
          ]"
          @click="selectMode(false)"
        >
          <span aria-hidden="true" :class="['i-lucide:keyboard size-4 shrink-0']" />
          {{ t('stage.chat.input-mode.text') }}
        </BasicButton>
        <BasicButton
          type="button"
          size="unset"
          data-testid="chat-input-mode-voice"
          :aria-pressed="voiceMode"
          :class="[
            modeButtonClasses,
            voiceMode ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-200' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
          ]"
          @click="selectMode(true)"
        >
          <span aria-hidden="true" :class="['i-lucide:mic size-4 shrink-0']" />
          {{ t('stage.chat.input-mode.voice') }}
        </BasicButton>
      </div>
    </div>
    <div v-show="!voiceMode" data-testid="chat-text-input" :class="['flex flex-col']">
      <slot />
    </div>
    <div v-show="voiceMode" data-testid="chat-voice-input" :class="['px-2 py-1']">
      <VoiceInputButton
        ref="voice-button"
        v-model="draft"
        :session-id="sessionId"
        :reply-to-message-id="replyToMessageId"
        :tools="tools"
        :status-element="voiceStatus"
        :attachment-element="attachmentElement"
        @recording-change="onRecordingChange"
        @pending-change="emit('pendingChange', $event)"
        @sent="emit('sent')"
        @submit="emit('submit')"
        @configure="emit('configure', $event)"
      />
      <div v-show="recording" ref="voice-status" :class="['min-w-0 flex items-center pt-1']" />
    </div>
  </div>
</template>
