import type { StreamingControlEmotion } from '@proj-airi/pipelines-audio'

/**
 * The mood of one character. ACT emotions move it, and it decays toward a calm baseline.
 * Decay is computed when the mood is read, so no timer runs.
 */
export interface CharacterMoodState {
  /** -1 to 1. Negative is unpleasant, positive is pleasant. */
  valence: number
  /** 0 to 1. Low is relaxed, high is excited. */
  arousal: number
  updatedAt: number
}

/** The relationship of one character with the user. It changes slowly with interaction. */
export interface CharacterAffectionState {
  /** 0 to 1000. Stage thresholds are 0, 200, 500, and 800. */
  points: number
  lastInteractionAt: number
  /** The local day of the last first-greeting bonus, as `YYYY-MM-DD`. */
  greetingDay?: string
  /** The local day that `roundPointsToday` counts, as `YYYY-MM-DD`. */
  roundPointsDay?: string
  roundPointsToday?: number
  /** Extraction batches whose affection delta is applied. A retried batch must not apply twice. */
  appliedEventIds?: string[]
}

export type AffectionStage = 'acquaintance' | 'friend' | 'affectionate' | 'bonded'

/**
 * Mood rules of spec 2.2. These are first values.
 *
 * - `inertia` is the share of the distance to the emotion target that one ACT emotion moves.
 * - `halfLifeMs` is the time in which the distance to the baseline halves.
 */
const moodRules = {
  inertia: 0.3,
  halfLifeMs: 20 * 60 * 1000,
  baseline: { valence: 0, arousal: 0.2 },
}

/** The point on the valence and arousal plane that each ACT emotion pulls the mood toward. */
const emotionTargets: Record<StreamingControlEmotion, { valence: number, arousal: number }> = {
  happy: { valence: 0.7, arousal: 0.6 },
  sad: { valence: -0.6, arousal: 0.3 },
  angry: { valence: -0.7, arousal: 0.8 },
  think: { valence: 0, arousal: 0.4 },
  surprised: { valence: 0.2, arousal: 0.8 },
  awkward: { valence: -0.2, arousal: 0.5 },
  question: { valence: 0, arousal: 0.5 },
  curious: { valence: 0.3, arousal: 0.6 },
  neutral: { valence: 0, arousal: 0.2 },
}

/**
 * Affection rules of spec 2.2. These are first values.
 *
 * - A completed round gives `roundPoints`, at most `dailyRoundPoints` in one local day.
 * - The first round of a local day also gives `greetingPoints`.
 * - After `inactiveDays` days without interaction, each further day removes `inactivityPointsPerDay`.
 *   The loss stops at half of the lower bound of the stage that the points had before the loss.
 */
const affectionRules = {
  roundPoints: 1,
  dailyRoundPoints: 20,
  greetingPoints: 5,
  inactiveDays: 3,
  inactivityPointsPerDay: 5,
  maxPoints: 1000,
  /** Lower bounds, ordered from the highest stage. */
  stages: [
    { stage: 'bonded', from: 800 },
    { stage: 'affectionate', from: 500 },
    { stage: 'friend', from: 200 },
    { stage: 'acquaintance', from: 0 },
  ] satisfies Array<{ stage: AffectionStage, from: number }>,
}

/** Extraction gives at most this delta for one batch, in each direction. */
const maxExtractionDelta = 10

/** How many applied batch ids one character keeps. */
const appliedEventIdLimit = 200

const dayMs = 24 * 60 * 60 * 1000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Formats a timestamp as the local calendar day.
 *
 * @example
 * localDay(new Date(2026, 9, 16, 23, 59).getTime())
 * // => '2026-10-16'
 */
function localDay(at: number) {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A character without stored mood starts at the baseline. */
export function initialMood(at: number): CharacterMoodState {
  return { ...moodRules.baseline, updatedAt: at }
}

/** Returns the mood at `at`, after decay toward the baseline since the last update. */
export function moodAt(state: CharacterMoodState, at: number): CharacterMoodState {
  const elapsed = Math.max(0, at - state.updatedAt)
  const remaining = 0.5 ** (elapsed / moodRules.halfLifeMs)
  return {
    valence: moodRules.baseline.valence + (state.valence - moodRules.baseline.valence) * remaining,
    arousal: moodRules.baseline.arousal + (state.arousal - moodRules.baseline.arousal) * remaining,
    updatedAt: at,
  }
}

/** Decays the mood to `at`, then moves it toward the target of `emotion` by the inertia share scaled by `intensity`. */
export function applyEmotion(state: CharacterMoodState, emotion: StreamingControlEmotion, intensity: number, at: number): CharacterMoodState {
  const current = moodAt(state, at)
  const target = emotionTargets[emotion]
  const step = moodRules.inertia * clamp(intensity, 0, 1)
  return {
    valence: clamp(current.valence + step * (target.valence - current.valence), -1, 1),
    arousal: clamp(current.arousal + step * (target.arousal - current.arousal), 0, 1),
    updatedAt: at,
  }
}

/** A character without stored affection starts as an acquaintance. */
export function initialAffection(at: number): CharacterAffectionState {
  return { points: 0, lastInteractionAt: at }
}

export function affectionStageOf(points: number): AffectionStage {
  return affectionRules.stages.find(({ from }) => points >= from)!.stage
}

function stageFloorOf(points: number) {
  return affectionRules.stages.find(({ from }) => points >= from)!.from
}

/** Returns the points at `at`, after the inactivity loss since the last interaction. Stored state does not change. */
export function affectionPointsAt(state: CharacterAffectionState, at: number): number {
  const inactiveDays = Math.floor(Math.max(0, at - state.lastInteractionAt) / dayMs)
  const lossDays = inactiveDays - affectionRules.inactiveDays
  if (lossDays <= 0)
    return state.points

  const floor = stageFloorOf(state.points) / 2
  // The loss never raises points that already sit below the floor.
  return Math.max(Math.min(state.points, floor), state.points - lossDays * affectionRules.inactivityPointsPerDay)
}

/** Commits the inactivity loss, then adds the points of one completed round and the first greeting of the day. */
export function recordRound(state: CharacterAffectionState, at: number): CharacterAffectionState {
  const day = localDay(at)
  const roundPointsToday = state.roundPointsDay === day ? state.roundPointsToday ?? 0 : 0
  const roundPoints = roundPointsToday < affectionRules.dailyRoundPoints ? affectionRules.roundPoints : 0
  const greetingPoints = state.greetingDay === day ? 0 : affectionRules.greetingPoints

  return {
    ...state,
    points: clamp(affectionPointsAt(state, at) + roundPoints + greetingPoints, 0, affectionRules.maxPoints),
    lastInteractionAt: at,
    greetingDay: day,
    roundPointsDay: day,
    roundPointsToday: roundPointsToday + roundPoints,
  }
}

/**
 * Applies the affection delta of one extraction batch. A batch that was already applied returns the state unchanged.
 * The delta is clamped to -10 to 10. It does not count as an interaction, so inactivity keeps its start time.
 */
export function applyAffectionDelta(state: CharacterAffectionState, eventId: string, delta: number, at: number): CharacterAffectionState {
  if (state.appliedEventIds?.includes(eventId))
    return state

  return {
    ...state,
    points: clamp(affectionPointsAt(state, at) + clamp(Math.round(delta), -maxExtractionDelta, maxExtractionDelta), 0, affectionRules.maxPoints),
    // Retries of a batch happen within minutes, so recent ids are enough to stop a second application.
    appliedEventIds: [...(state.appliedEventIds ?? []), eventId].slice(-appliedEventIdLimit),
  }
}

function describeValence(valence: number) {
  if (valence < -0.5)
    return 'sad'
  if (valence < -0.15)
    return 'a little down'
  if (valence <= 0.15)
    return 'even'
  if (valence <= 0.5)
    return 'slightly happy'
  return 'happy'
}

function describeArousal(arousal: number) {
  if (arousal < 0.3)
    return 'relaxed'
  if (arousal <= 0.65)
    return 'attentive'
  return 'excited'
}

const relationshipGuidance: Record<AffectionStage, string> = {
  acquaintance: 'You are still getting to know the user. Be friendly and polite.',
  friend: 'You are friends. Speak casually and recall shared topics.',
  affectionate: 'You are close to the user. Show warmth and care openly.',
  bonded: 'You and the user share a deep bond. Speak with trust and familiarity.',
}

/**
 * Describes the mood and the relationship in words for the model. Raw numbers never reach the prompt.
 *
 * @example
 * describeCharacterState({ valence: 0.4, arousal: 0.2, updatedAt: 0 }, 'friend')
 * // => 'Current mood: slightly happy, relaxed. Relationship: friend. You are friends. Speak casually and recall shared topics. ...'
 */
export function describeCharacterState(mood: CharacterMoodState, stage: AffectionStage): string {
  return [
    `Current mood: ${describeValence(mood.valence)}, ${describeArousal(mood.arousal)}.`,
    `Relationship: ${stage}. ${relationshipGuidance[stage]}`,
    'This state only colors your tone. It never overrides your personality or its boundaries.',
  ].join(' ')
}
