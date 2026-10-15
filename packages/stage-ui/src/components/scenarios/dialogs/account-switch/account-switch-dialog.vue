<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useI18n } from 'vue-i18n'

import { useAccountSwitchConfirmation } from '../../../../services/account-switch'

const { t } = useI18n()
const { confirmation, wait, force } = useAccountSwitchConfirmation()
</script>

<template>
  <DialogRoot :open="confirmation !== 'closed'">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[10010] bg-black/50']" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[10010] -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-md overflow-y-auto rounded-lg p-6 shadow-xl',
          'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100',
        ]"
        @escape-key-down.prevent
        @interact-outside.prevent
      >
        <DialogTitle :class="['text-lg font-semibold']">
          {{ t('settings.pages.account.switch.title') }}
        </DialogTitle>
        <DialogDescription :class="['mt-2 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.account.switch.description') }}
        </DialogDescription>
        <div :class="['mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2']">
          <Button
            :class="['min-h-11 w-full']"
            :loading="confirmation === 'waiting'"
            :label="t('settings.pages.account.switch.wait')"
            @click="wait"
          />
          <Button
            :class="['min-h-11 w-full']"
            color="red"
            :label="t('settings.pages.account.switch.force')"
            @click="force"
          />
        </div>
        <p v-if="confirmation === 'waiting'" role="status" :class="['mt-3 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.account.switch.waiting') }}
        </p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
