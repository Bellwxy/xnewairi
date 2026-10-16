import type { CharacterRoutine, DayActivity, ProactiveHistory } from './proactive-math'

import { describe, expect, it } from 'vitest'

import { automaticRoutines, automaticTimes, dueRoutine, isQuiet, planNotifications, quietHoursFor, recordActivity, recordFired } from './proactive-math'

function at(day: number, hour: number, minute = 0) {
  return new Date(2026, 9, day, hour, minute).getTime()
}

function week(first: number, last: number): DayActivity[] {
  return Array.from({ length: 7 }, (_, index) => ({ day: `2026-10-${String(index + 1).padStart(2, '0')}`, first, last }))
}

const emptyHistory: ProactiveHistory = { lastFiredAt: {}, firedPerDay: {} }

describe('automatic times', () => {
  it('uses 08:30 and 23:30 before 7 active days', () => {
    expect(automaticTimes(week(7 * 60, 22 * 60).slice(0, 6))).toEqual({ morning: 8 * 60 + 30, night: 23 * 60 + 30 })
  })

  it('follows the median first and last activity after 7 days', () => {
    expect(automaticTimes(week(9 * 60 + 15, 22 * 60 + 40))).toEqual({ morning: 9 * 60 + 15, night: 22 * 60 + 40 })
  })

  it('counts a last activity after midnight as part of the night', () => {
    expect(automaticTimes(week(9 * 60, 40)).night).toBe(40)
  })

  it('keeps each time in its range', () => {
    expect(automaticTimes(week(4 * 60, 18 * 60))).toEqual({ morning: 6 * 60, night: 21 * 60 + 30 })
    expect(automaticTimes(week(13 * 60, 5 * 60)).morning).toBe(11 * 60)
    expect(automaticTimes(week(13 * 60, 5 * 60)).night).toBe(90)
  })
})

describe('quiet hours', () => {
  it('runs from 30 minutes after the reminder to 30 minutes before the greeting', () => {
    const quiet = quietHoursFor({ morning: 8 * 60 + 30, night: 23 * 60 + 30 })

    expect(quiet).toEqual({ start: 0, end: 8 * 60 })
    expect(isQuiet(quiet, 3 * 60)).toBe(true)
    expect(isQuiet(quiet, 8 * 60 + 30)).toBe(false)
    expect(isQuiet(quiet, 23 * 60 + 30)).toBe(false)
  })

  it('handles quiet hours that cross midnight', () => {
    const quiet = quietHoursFor({ morning: 7 * 60, night: 22 * 60 })

    expect(isQuiet(quiet, 23 * 60)).toBe(true)
    expect(isQuiet(quiet, 6 * 60)).toBe(true)
    expect(isQuiet(quiet, 12 * 60)).toBe(false)
  })
})

describe('recordActivity', () => {
  it('keeps the first and last minute of each day', () => {
    let log = recordActivity([], at(16, 9))
    log = recordActivity(log, at(16, 21, 30))
    log = recordActivity(log, at(16, 12))

    expect(log).toEqual([{ day: '2026-10-16', first: 9 * 60, last: 21 * 60 + 30 }])
  })
})

describe('dueRoutine', () => {
  const routines = automaticRoutines([])
  const quiet = quietHoursFor({ morning: 8 * 60 + 30, night: 23 * 60 + 30 })

  it('fires the morning greeting at 08:30 once', () => {
    const due = dueRoutine(routines, emptyHistory, quiet, at(16, 8, 30))
    expect(due?.kind).toBe('morning-greeting')

    const history = recordFired(emptyHistory, due!.id, at(16, 8, 30))
    expect(dueRoutine(routines, history, quiet, at(16, 8, 31))).toBeUndefined()
  })

  it('fires a routine missed by up to 2 hours, and not later', () => {
    expect(dueRoutine(routines, emptyHistory, quiet, at(16, 10, 15))?.kind).toBe('morning-greeting')
    expect(dueRoutine(routines, emptyHistory, quiet, at(16, 10, 45))).toBeUndefined()
  })

  it('fires nothing in quiet hours', () => {
    const lateRoutine: CharacterRoutine = { id: 'custom', kind: 'custom', origin: 'user', schedule: { type: 'daily', minute: 2 * 60 } }

    expect(dueRoutine([lateRoutine], emptyHistory, quiet, at(16, 2))).toBeUndefined()
  })

  it('fires nothing after three messages in one day', () => {
    const history: ProactiveHistory = { lastFiredAt: {}, firedPerDay: { '2026-10-16': 3 } }

    expect(dueRoutine(routines, history, quiet, at(16, 8, 30))).toBeUndefined()
  })

  it('fires an anniversary only on its day', () => {
    const birthday: CharacterRoutine = { id: 'anniversary-e1', kind: 'anniversary', origin: 'auto', schedule: { type: 'yearly', month: 10, day: 17, minute: 9 * 60 } }

    expect(dueRoutine([birthday], emptyHistory, quiet, at(16, 9))).toBeUndefined()
    expect(dueRoutine([birthday], emptyHistory, quiet, at(17, 9))?.id).toBe('anniversary-e1')
  })
})

describe('planNotifications', () => {
  const quiet = quietHoursFor({ morning: 8 * 60 + 30, night: 23 * 60 + 30 })
  const custom = (id: string, minute: number): CharacterRoutine => ({ id, kind: 'custom', origin: 'user', note: id, schedule: { type: 'daily', minute } })

  it('plans each routine of the next 7 days once', () => {
    const plan = planNotifications(automaticRoutines([]), emptyHistory, quiet, at(16, 6))

    expect(plan).toHaveLength(14)
    expect(plan[0]).toMatchObject({ routine: { kind: 'morning-greeting' }, at: at(16, 8, 30) })
    expect(plan.at(-1)).toMatchObject({ routine: { kind: 'night-reminder' }, at: at(22, 23, 30) })
  })

  it('plans nothing in quiet hours', () => {
    const plan = planNotifications([custom('late', 3 * 60)], emptyHistory, quiet, at(16, 6))

    expect(plan).toEqual([])
  })

  it('plans at most 3 a day, counted with messages that already fired today', () => {
    const routines = [...automaticRoutines([]), custom('lunch', 12 * 60), custom('tea', 15 * 60), custom('dinner', 19 * 60)]
    const history: ProactiveHistory = { lastFiredAt: { 'morning-greeting': at(16, 8, 30) }, firedPerDay: { '2026-10-16': 1 } }

    const plan = planNotifications(routines, history, quiet, at(16, 9))
    const today = plan.filter(entry => new Date(entry.at).getDate() === 16)
    const tomorrow = plan.filter(entry => new Date(entry.at).getDate() === 17)

    expect(today.map(entry => entry.routine.id)).toEqual(['lunch', 'tea'])
    expect(tomorrow.map(entry => entry.routine.id)).toEqual(['morning-greeting', 'lunch', 'tea'])
  })

  it('plans an anniversary only on its day', () => {
    const birthday: CharacterRoutine = { id: 'anniversary-e1', kind: 'anniversary', origin: 'auto', schedule: { type: 'yearly', month: 10, day: 18, minute: 9 * 60 } }

    expect(planNotifications([birthday], emptyHistory, quiet, at(16, 6)).map(entry => entry.at)).toEqual([at(18, 9)])
  })
})
