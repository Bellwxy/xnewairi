import type { PluginListenerHandle } from '@capacitor/core'

import { LocalNotifications } from '@capacitor/local-notifications'
import { errorMessageFrom } from '@moeru/std'
import { useProactiveCareStore } from '@proj-airi/stage-ui/stores/character/proactive'
import { useCharacterMemoryStore } from '@proj-airi/stage-ui/stores/memory/memory-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useDocumentVisibility, useIntervalFn, watchDebounced } from '@vueuse/core'
import { onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/** Marks the notifications that proactive care owns, so a reschedule never cancels notifications of other features. */
const notificationSource = 'proactive-care'

/**
 * Proactive notification ids are `idBase` plus the plan index. Android needs 32-bit integer ids.
 * A plan has at most 21 entries, 3 a day for 7 days. Each reschedule cancels the previous set first.
 */
const idBase = 7100

/**
 * The plan covers 7 days of one-time notifications. Rebuilding it every hour keeps it ahead of time,
 * and it also counts the messages that fired since the last plan.
 */
const rebuildIntervalMs = 60 * 60 * 1000

/** Without permission, the composable checks again this often while the app is visible, so a later grant takes effect. */
const permissionRetryMs = 60 * 1000

/**
 * Schedules system notifications for the proactive routines of the selected character on Android.
 *
 * The WebView cannot run timers in the background, so a notification stands in for the character.
 * Its text is a fixed template. Tapping it opens the app, and the store check then lets the character speak.
 * The plan follows the routines and the history: a change of times, character, memory, or fired messages rebuilds it.
 */
export function useProactiveNotifications() {
  const { t } = useI18n()
  const proactive = useProactiveCareStore()
  const memory = useCharacterMemoryStore()
  const cards = useAiriCardStore()
  const visibility = useDocumentVisibility()
  let actionListener: PluginListenerHandle | undefined
  let granted = false
  /** Rebuilds run one after another, so the cancel of one never removes the notifications that another just scheduled. */
  let queue = Promise.resolve()

  function reschedule() {
    queue = queue.then(rebuild)
    return queue
  }

  async function rebuild() {
    try {
      const pending = await LocalNotifications.getPending()
      const owned = pending.notifications.filter(notification => notification.extra?.source === notificationSource)
      if (owned.length)
        await LocalNotifications.cancel({ notifications: owned.map(notification => ({ id: notification.id })) })

      // The onboarding permission step asks for the permission. Without it, nothing is scheduled yet.
      granted = (await LocalNotifications.checkPermissions()).display === 'granted'
      if (!granted)
        return

      const plan = await proactive.notificationPlan()
      if (!plan.length)
        return
      await LocalNotifications.schedule({
        notifications: plan.map((entry, index) => ({
          id: idBase + index,
          title: cards.activeCard?.name ?? 'AIRI',
          body: t(`settings.pages.modules.proactive-care.notification.${entry.routine.kind}`),
          schedule: { at: new Date(entry.at), allowWhileIdle: true },
          extra: { source: notificationSource, routineId: entry.routine.id },
        })),
      })
    }
    catch (error) {
      console.warn('[proactive-care] Failed to schedule notifications:', errorMessageFrom(error))
    }
  }

  watchDebounced(
    [() => proactive.enabled, () => proactive.times, () => proactive.customRoutines, () => proactive.history, () => cards.activeCardId, () => memory.revisions[cards.activeCardId]],
    () => void reschedule(),
    { debounce: 1000, immediate: true, deep: true },
  )

  // Returning to the foreground rebuilds the plan, for example after the user granted the permission in system settings.
  watch(visibility, (state) => {
    if (state === 'visible')
      void reschedule()
  })
  useIntervalFn(() => void reschedule(), rebuildIntervalMs)
  // A grant inside the app, for example in the permission panel, does not change visibility, so it needs this check.
  useIntervalFn(() => {
    if (!granted && visibility.value === 'visible')
      void reschedule()
  }, permissionRetryMs)

  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    if (action.notification.extra?.source === notificationSource)
      void proactive.check()
  }).then((handle) => {
    actionListener = handle
  })

  onUnmounted(() => {
    void actionListener?.remove()
  })
}
