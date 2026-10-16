<script setup lang="ts">
import { Button, Collapsible, FieldCheckbox, FieldInput, IconButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProactiveCareStore } from '../../stores/character/proactive'
import { useAiriCardStore } from '../../stores/modules/airi-card'

const { t } = useI18n()
const proactive = useProactiveCareStore()
const { enabled, times, quietHours, customRoutines } = storeToRefs(proactive)
const { activeCardId } = storeToRefs(useAiriCardStore())

// The store is synchronized. The page writes through its actions, so the leader applies each change once.
const enabledModel = computed({
  get: () => enabled.value,
  set: (value: boolean) => void proactive.setEnabled(value),
})

/**
 * Formats minutes after midnight as a clock time.
 *
 * @example
 * formatMinute(510)
 * // => '08:30'
 */
function formatMinute(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

const scheduleText = computed(() => t('settings.pages.modules.proactive-care.schedule', {
  morning: formatMinute(times.value.morning),
  night: formatMinute(times.value.night),
  quietStart: formatMinute(quietHours.value.start),
  quietEnd: formatMinute(quietHours.value.end),
}))

/** Custom routines belong to the selected character, like its messages. */
const routines = computed(() => customRoutines.value[activeCardId.value] ?? [])
const newTime = ref('20:00')
const newNote = ref('')

function addRoutine() {
  const [hour, minute] = newTime.value.split(':').map(Number)
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute) || !newNote.value.trim())
    return
  proactive.addCustomRoutine(activeCardId.value, hour * 60 + minute, newNote.value.trim())
  newNote.value = ''
}
</script>

<template>
  <SettingsCard>
    <FieldCheckbox
      v-model="enabledModel"
      :label="t('settings.pages.modules.proactive-care.enable')"
      :description="t('settings.pages.modules.proactive-care.enable-description')"
    />

    <template v-if="enabled">
      <div :class="['flex flex-col gap-1']">
        <p :class="['text-sm tabular-nums', 'text-neutral-700 dark:text-neutral-200']">
          {{ scheduleText }}
        </p>
        <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.proactive-care.schedule-note') }}
        </p>
      </div>

      <Collapsible :label="t('settings.pages.modules.proactive-care.advanced')">
        <section :class="['flex flex-col gap-3', 'pt-3']">
          <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
            {{ t('settings.pages.modules.proactive-care.custom.title') }}
          </h3>
          <p v-if="!routines.length" :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.modules.proactive-care.custom.empty') }}
          </p>
          <ul v-else :class="['flex flex-col gap-1']">
            <li v-for="routine in routines" :key="routine.id" :class="['flex items-center gap-2', 'rounded-lg px-3 py-2', 'hover:bg-neutral-100 dark:hover:bg-neutral-900']">
              <span :class="['shrink-0 text-sm tabular-nums', 'text-neutral-500 dark:text-neutral-400']">
                {{ formatMinute(routine.schedule.minute) }}
              </span>
              <span :class="['min-w-0 flex-1 text-sm', 'text-neutral-700 dark:text-neutral-200']">
                {{ routine.note }}
              </span>
              <IconButton
                icon="i-solar:trash-bin-minimalistic-bold-duotone"
                :aria-label="t('settings.pages.modules.proactive-care.custom.remove')"
                :title="t('settings.pages.modules.proactive-care.custom.remove')"
                @click="proactive.removeCustomRoutine(activeCardId, routine.id)"
              />
            </li>
          </ul>
          <div :class="['grid grid-cols-1 items-end gap-3 sm:grid-cols-[8rem_1fr_auto]']">
            <FieldInput v-model="newTime" type="time" :label="t('settings.pages.modules.proactive-care.custom.time')" />
            <FieldInput v-model="newNote" :label="t('settings.pages.modules.proactive-care.custom.note')" />
            <Button :label="t('settings.pages.modules.proactive-care.custom.add')" :disabled="!newNote.trim()" @click="addRoutine" />
          </div>
        </section>
      </Collapsible>
    </template>
  </SettingsCard>
</template>
