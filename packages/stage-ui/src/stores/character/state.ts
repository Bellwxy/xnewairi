import type { StreamingControlEmotion } from '@proj-airi/pipelines-audio'

import type { CharacterAffectionState, CharacterMoodState } from './mood-math'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { toRaw } from 'vue'

import {
  affectionPointsAt,
  affectionStageOf,
  applyAffectionDelta as applyAffectionDeltaTo,
  applyEmotion,
  describeCharacterState,
  initialAffection,
  initialMood,
  moodAt,
  recordRound as recordRoundOn,
} from './mood-math'

/**
 * Mood and affection of each character, keyed by character card id.
 *
 * The chat leader writes this state: ACT emotions of a reply move the mood, and each completed round adds affection.
 * Every window reads it, and the prompt of the next request describes it.
 * The state lives in the account scope. Deleting a card deletes its state. Editing a card keeps it.
 */
export const useCharacterStateStore = defineStore('character-state', () => {
  // Pinia synchronization owns cross-window updates, so storage events stay off, as in the card store.
  const moods = useLocalStorageManualReset<Record<string, CharacterMoodState>>('character-state/moods', {}, { listenToStorageChanges: false })
  const affections = useLocalStorageManualReset<Record<string, CharacterAffectionState>>('character-state/affections', {}, { listenToStorageChanges: false })

  async function recordEmotion(characterId: string, emotion: StreamingControlEmotion, intensity: number, at = Date.now()) {
    const current = moods.value[characterId] ?? initialMood(at)
    moods.value = { ...moods.value, [characterId]: applyEmotion(structuredClone(toRaw(current)), emotion, intensity, at) }
  }

  async function recordRound(characterId: string, at = Date.now()) {
    const current = affections.value[characterId] ?? initialAffection(at)
    affections.value = { ...affections.value, [characterId]: recordRoundOn(structuredClone(toRaw(current)), at) }
  }

  /** Applies the affection delta of one memory extraction batch. A repeated `eventId` changes nothing. */
  async function applyAffectionDelta(characterId: string, eventId: string, delta: number, at = Date.now()) {
    const current = affections.value[characterId] ?? initialAffection(at)
    affections.value = { ...affections.value, [characterId]: applyAffectionDeltaTo(structuredClone(toRaw(current)), eventId, delta, at) }
  }

  async function forgetCharacter(characterId: string) {
    const { [characterId]: _mood, ...otherMoods } = moods.value
    const { [characterId]: _affection, ...otherAffections } = affections.value
    moods.value = otherMoods
    affections.value = otherAffections
  }

  /** Describes the state of a character at `at` for the prompt. A character without stored state reads as calm and new. */
  function describe(characterId: string, at = Date.now()) {
    const mood = moodAt(moods.value[characterId] ?? initialMood(at), at)
    const affection = affections.value[characterId] ?? initialAffection(at)
    return describeCharacterState(mood, affectionStageOf(affectionPointsAt(affection, at)))
  }

  function resetState() {
    moods.reset()
    affections.reset()
  }

  return {
    moods,
    affections,
    recordEmotion,
    recordRound,
    applyAffectionDelta,
    forgetCharacter,
    describe,
    resetState,
  }
}, {
  synced: {
    actions: ['recordEmotion', 'recordRound', 'applyAffectionDelta', 'forgetCharacter'],
    state: true,
  },
})
