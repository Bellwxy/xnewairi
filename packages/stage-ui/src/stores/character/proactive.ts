import type { WebSocketEventOf } from '@proj-airi/server-sdk'

import type { CharacterRoutine, DayActivity, ProactiveHistory } from './proactive-math'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useDocumentVisibility } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { useChatSessionStore } from '../chat/session-store'
import { validEpisodes } from '../memory/memory-document'
import { useAiriCardStore } from '../modules/airi-card'
import { useCharacterOrchestratorStore } from './orchestrator'
import { automaticRoutines, automaticTimes, dueRoutine, localDay, planNotifications, quietHoursFor, recordActivity, recordFired } from './proactive-math'

/** The leader checks for due routines this often. A desktop tray app fires a routine within this time of its schedule. */
const checkIntervalMs = 60_000

/** An anniversary fires this many minutes after the morning greeting, so the two never share one message. */
const anniversaryDelayMinutes = 30

/** Removes streaming control tokens such as `<|ACT ...|>`, which belong to the stage, not to the stored message. */
function speechText(reaction: string) {
  return reaction.replace(/<\|[\s\S]*?\|>/g, '').trim()
}

/** The instruction of each routine for the model. The note carries the occasion in the words of the user. */
function headlineOf(routine: CharacterRoutine) {
  switch (routine.kind) {
    case 'morning-greeting':
      return 'Morning greeting. Greet the user for the new day in one or two short sentences.'
    case 'night-reminder':
      return 'Night reminder. It is late for the user. Gently suggest rest in one or two short sentences.'
    case 'anniversary':
      return `Anniversary today: ${routine.note ?? ''}. Celebrate it with the user in one or two short sentences.`
    case 'custom':
      return `Scheduled check-in: ${routine.note ?? ''}. Talk to the user about it in one or two short sentences.`
  }
}

/**
 * Proactive care of spec 2.3: the selected character speaks first at times that follow the user.
 *
 * Every window reads the settings. Only the chat leader runs the checks, because it owns chat sessions.
 * The leader writes each proactive message to the active session with `source: 'proactive'`,
 * so the character remembers what it said.
 *
 * Android cannot run timers in the background. The Pocket app schedules system notifications from
 * `notificationPlan`, and the store checks again when the app returns to the foreground.
 */
export const useProactiveCareStore = defineStore('proactive-care', () => {
  // Pinia synchronization owns cross-window updates, so storage events stay off, as in the card store.
  // Every write is a synchronized action, so an older window cannot send a full snapshot over newer counters.
  const storageOptions = { listenToStorageChanges: false }
  const enabled = useLocalStorageManualReset<boolean>('settings/proactive-care/enabled', true, storageOptions)
  const activity = useLocalStorageManualReset<DayActivity[]>('proactive-care/activity', [], storageOptions)
  const history = useLocalStorageManualReset<ProactiveHistory>('proactive-care/history', { lastFiredAt: {}, firedPerDay: {} }, storageOptions)
  /** Routines that the user added in the advanced section, by character card id. */
  const customRoutines = useLocalStorageManualReset<Record<string, CharacterRoutine[]>>('proactive-care/custom-routines', {}, storageOptions)

  const times = computed(() => automaticTimes(activity.value))
  const quietHours = computed(() => quietHoursFor(times.value))

  const cards = useAiriCardStore()
  const { activeCardId } = storeToRefs(cards)
  const chatSession = useChatSessionStore()
  const visibility = useDocumentVisibility()

  let timer: ReturnType<typeof setInterval> | undefined
  let stopVisibilityListener: (() => void) | undefined
  /** True while one proactive message is being written. Checks during that time do nothing. */
  const firing = ref(false)

  /** Called by the chat leader after each completed round. The log moves the automatic times. */
  async function recordInteraction(at = Date.now()) {
    activity.value = recordActivity(activity.value, at)
  }

  async function setEnabled(value: boolean) {
    enabled.value = value
  }

  async function markFired(routineId: string, at: number) {
    history.value = recordFired(history.value, routineId, at)
  }

  /**
   * The routines of a character: the automatic greeting and reminder, an anniversary for each memory entry with a yearly
   * date, and the custom routines. Anniversaries come from memory, so a deleted or replaced entry removes its routine.
   */
  async function routinesFor(characterId: string): Promise<CharacterRoutine[]> {
    const document = await characterMemoryRepo.get(characterId)
    const anniversaries: CharacterRoutine[] = (document ? validEpisodes(document) : [])
      .filter(episode => episode.annualDate)
      .map(episode => ({
        id: `anniversary-${episode.id}`,
        kind: 'anniversary',
        origin: 'auto',
        sourceEpisodeId: episode.id,
        note: episode.text,
        schedule: { type: 'yearly', month: episode.annualDate!.month, day: episode.annualDate!.day, minute: times.value.morning + anniversaryDelayMinutes },
      }))
    return [...automaticRoutines(activity.value), ...anniversaries, ...(customRoutines.value[characterId] ?? [])]
  }

  async function fire(sessionId: string, routine: CharacterRoutine, at: number) {
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'character:proactive-care',
      data: {
        id: `proactive-${routine.id}-${localDay(at)}`,
        eventId: routine.id,
        kind: 'reminder',
        urgency: 'immediate',
        headline: headlineOf(routine),
        destinations: ['character'],
        payload: { routineKind: routine.kind },
      },
    }

    const reaction = await useCharacterOrchestratorStore().handleSparkNotifyWithReaction(event, { forceResponse: true })
    const text = speechText(reaction)
    if (!text)
      return

    chatSession.appendSessionMessage(sessionId, {
      role: 'assistant',
      content: text,
      slices: [{ type: 'text', text }],
      tool_results: [],
      id: nanoid(),
      createdAt: Date.now(),
      source: 'proactive',
    })
  }

  /**
   * Fires the due routine of the selected character, at most one per call.
   * It never rejects, because timers and visibility changes call it without waiting.
   */
  async function check(at = Date.now()) {
    if (!enabled.value || firing.value)
      return

    firing.value = true
    try {
      const characterId = activeCardId.value
      const sessionId = chatSession.activeSessionId
      // The selected card speaks into its active session. Before the sessions load, nothing fires,
      // and the routine stays due for a later check within its catch-up time.
      if (!sessionId || chatSession.sessionMetas[sessionId]?.characterId !== characterId)
        return

      const routine = dueRoutine(await routinesFor(characterId), history.value, quietHours.value, at)
      if (!routine)
        return

      // The routine counts as fired before generation, so a failing model cannot repeat it every minute.
      await markFired(routine.id, at)
      await fire(sessionId, routine, at)
    }
    catch (error) {
      console.warn('[proactive-care] A proactive message failed:', errorMessageFrom(error))
    }
    finally {
      firing.value = false
    }
  }

  /** Starts the checks in this window. Only the chat leader calls it. Calling it again does nothing. */
  function start() {
    if (timer)
      return
    timer = setInterval(() => void check(), checkIntervalMs)
    // Returning to the foreground fires a routine that Android missed while the app slept.
    stopVisibilityListener = watch(visibility, (state) => {
      if (state === 'visible')
        void check()
    })
    void check()
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    stopVisibilityListener?.()
    stopVisibilityListener = undefined
  }

  async function addCustomRoutine(characterId: string, minute: number, note: string) {
    const routine: CharacterRoutine = { id: `custom-${nanoid()}`, kind: 'custom', origin: 'user', note, schedule: { type: 'daily', minute } }
    customRoutines.value = { ...customRoutines.value, [characterId]: [...(customRoutines.value[characterId] ?? []), routine] }
  }

  async function removeCustomRoutine(characterId: string, routineId: string) {
    customRoutines.value = { ...customRoutines.value, [characterId]: (customRoutines.value[characterId] ?? []).filter(routine => routine.id !== routineId) }
  }

  /**
   * The one-time system notifications that Android shows for the next 7 days. Their text is a fixed template, not a model reply.
   * The plan applies quiet hours and the daily limit, because the app cannot check them while it sleeps.
   */
  async function notificationPlan(from = Date.now()) {
    return enabled.value ? planNotifications(await routinesFor(activeCardId.value), history.value, quietHours.value, from) : []
  }

  async function resetState() {
    enabled.reset()
    activity.reset()
    history.reset()
    customRoutines.reset()
  }

  return {
    enabled,
    activity,
    history,
    customRoutines,
    times,
    quietHours,
    recordInteraction,
    setEnabled,
    markFired,
    routinesFor,
    check,
    start,
    stop,
    addCustomRoutine,
    removeCustomRoutine,
    notificationPlan,
    resetState,
  }
}, {
  synced: {
    actions: ['recordInteraction', 'setEnabled', 'markFired', 'addCustomRoutine', 'removeCustomRoutine', 'resetState'],
    state: true,
  },
})
