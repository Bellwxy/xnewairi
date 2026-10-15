<script setup lang="ts">
import type { DataSettingsStatusEmits } from '../status'

import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { deleteDeviceAccountData, listDeviceAccounts } from '@proj-airi/stage-ui/services/account-device-data'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { DoubleCheckButton } from '@proj-airi/ui'
import { onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { createDataSettingsStatusHelpers } from '../status'

const emit = defineEmits<DataSettingsStatusEmits>()
const { t } = useI18n()
const authStore = useAuthStore()
const { emitStatus, handleActionError } = createDataSettingsStatusHelpers(emit)

// The account of a page never changes. A switch reloads the page.
const currentAccountId = getAccountScope().accountId
const accounts = shallowRef<string[]>([currentAccountId])

async function refresh() {
  try {
    accounts.value = await listDeviceAccounts()
  }
  catch (error) {
    handleActionError(error)
  }
}

async function deleteAccount(accountId: string) {
  try {
    await deleteDeviceAccountData(accountId)
    emitStatus(t('settings.pages.data.status.account_data_deleted'))
  }
  catch (error) {
    handleActionError(error)
  }
  await refresh()
}

/** The device stores no names of other accounts, so only the current account can show its user name. */
function labelOf(accountId: string) {
  if (accountId === 'local')
    return t('settings.pages.data.sections.accounts.signed_out')
  if (accountId === currentAccountId && authStore.user?.name)
    return authStore.user.name
  return accountId
}

onMounted(refresh)
</script>

<template>
  <div :class="['border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm', 'dark:border-neutral-800/60 dark:bg-neutral-900/60']">
    <div :class="['flex flex-col gap-1 md:max-w-[560px]']">
      <div :class="['text-lg font-medium']">
        {{ t('settings.pages.data.sections.accounts.title') }}
      </div>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.data.sections.accounts.description') }}
      </p>
    </div>

    <ul :class="['mt-3 flex flex-col gap-2']">
      <li
        v-for="accountId in accounts"
        :key="accountId"
        :class="['grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto]']"
      >
        <div :class="['flex flex-col gap-0.5 min-w-0']">
          <span :class="['text-sm font-medium break-all']">
            {{ labelOf(accountId) }}
          </span>
          <span
            v-if="accountId === currentAccountId"
            :class="['text-xs text-neutral-500 dark:text-neutral-400']"
          >
            {{ t('settings.pages.data.sections.accounts.current') }}
          </span>
        </div>
        <DoubleCheckButton v-if="accountId !== currentAccountId" @confirm="deleteAccount(accountId)">
          {{ t('settings.pages.data.sections.accounts.delete') }}
          <template #confirm>
            {{ t('settings.pages.data.confirmations.yes') }}
          </template>
          <template #cancel>
            {{ t('settings.pages.card.cancel') }}
          </template>
        </DoubleCheckButton>
      </li>
    </ul>

    <p
      v-if="accounts.length === 1"
      :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']"
    >
      {{ t('settings.pages.data.sections.accounts.empty') }}
    </p>
  </div>
</template>
