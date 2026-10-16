import { describe, expect, it } from 'vitest'

import {
  affectionPointsAt,
  affectionStageOf,
  applyAffectionDelta,
  applyEmotion,
  describeCharacterState,
  initialAffection,
  initialMood,
  moodAt,
  recordRound,
} from './mood-math'

const start = new Date(2026, 9, 16, 9, 0).getTime()
const minute = 60 * 1000
const day = 24 * 60 * minute

describe('mood', () => {
  it('stays positive after two happy emotions and one sad emotion', () => {
    let mood = initialMood(start)
    mood = applyEmotion(mood, 'happy', 1, start)
    mood = applyEmotion(mood, 'happy', 1, start)
    mood = applyEmotion(mood, 'sad', 1, start)

    expect(mood.valence).toBeGreaterThan(0)
  })

  it('moves less with a lower intensity', () => {
    const strong = applyEmotion(initialMood(start), 'happy', 1, start)
    const weak = applyEmotion(initialMood(start), 'happy', 0.5, start)

    expect(weak.valence).toBeLessThan(strong.valence)
    expect(weak.valence).toBeGreaterThan(0)
  })

  it('returns close to the baseline after one hour', () => {
    const excited = { valence: 0.8, arousal: 0.9, updatedAt: start }

    const later = moodAt(excited, start + 60 * minute)

    // Three half-lives leave one eighth of the distance.
    expect(later.valence).toBeCloseTo(0.1)
    expect(later.arousal).toBeCloseTo(0.2 + 0.7 / 8)
  })

  it('decays before it applies a new emotion', () => {
    const happy = { valence: 0.8, arousal: 0.6, updatedAt: start }

    const afterLongPause = applyEmotion(happy, 'neutral', 0, start + 20 * minute)

    expect(afterLongPause.valence).toBeCloseTo(0.4)
  })
})

describe('affection', () => {
  it('gives the greeting bonus once per local day', () => {
    let state = initialAffection(start)
    state = recordRound(state, start)
    state = recordRound(state, start + minute)

    expect(state.points).toBe(7)

    state = recordRound(state, start + day)
    expect(state.points).toBe(13)
  })

  it('stops round points at 20 per day', () => {
    let state = initialAffection(start)
    for (let index = 0; index < 30; index++)
      state = recordRound(state, start + index * minute)

    expect(state.points).toBe(25)
    expect(state.roundPointsToday).toBe(20)
  })

  it('loses 5 points per day after 3 inactive days, down to half of the stage floor', () => {
    const friend = { points: 260, lastInteractionAt: start }

    expect(affectionPointsAt(friend, start + 3 * day)).toBe(260)
    expect(affectionPointsAt(friend, start + 5 * day)).toBe(250)
    // The friend stage starts at 200, so the loss stops at 100.
    expect(affectionPointsAt(friend, start + 100 * day)).toBe(100)
  })

  it('never raises points that already sit below the floor', () => {
    const acquaintance = { points: 30, lastInteractionAt: start }

    expect(affectionPointsAt(acquaintance, start + 30 * day)).toBe(0)
  })

  it('applies an extraction delta once per batch and clamps it', () => {
    let state = { points: 100, lastInteractionAt: start }
    state = applyAffectionDelta(state, 'batch-1', 25, start)
    state = applyAffectionDelta(state, 'batch-1', 25, start)

    expect(state.points).toBe(110)
  })

  it('maps points to stages', () => {
    expect(affectionStageOf(0)).toBe('acquaintance')
    expect(affectionStageOf(199)).toBe('acquaintance')
    expect(affectionStageOf(200)).toBe('friend')
    expect(affectionStageOf(500)).toBe('affectionate')
    expect(affectionStageOf(800)).toBe('bonded')
  })
})

describe('describeCharacterState', () => {
  it('describes the state in words without raw numbers', () => {
    const text = describeCharacterState({ valence: 0.4, arousal: 0.2, updatedAt: start }, 'friend')

    expect(text).toContain('Current mood: slightly happy, relaxed.')
    expect(text).toContain('Relationship: friend.')
    expect(text).not.toMatch(/\d/)
  })

  it('changes the text when the stage changes', () => {
    const mood = initialMood(start)

    expect(describeCharacterState(mood, 'acquaintance')).not.toBe(describeCharacterState(mood, 'bonded'))
  })
})
