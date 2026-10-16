/**
 * Schedule rules of spec 2.3. These are first values.
 *
 * - Without 7 days of activity, the morning greeting is at 08:30 and the night reminder at 23:30.
 * - With 7 days of activity, the greeting moves to the median first activity and the reminder to the median last activity,
 *   each kept in its range.
 * - Quiet hours start 30 minutes after the night reminder and end 30 minutes before the greeting.
 * - At most `dailyLimit` proactive messages a day. A routine missed by up to `catchUpMs` still fires once.
 */
const scheduleRules = {
  defaultMorning: 8 * 60 + 30,
  defaultNight: 23 * 60 + 30,
  morningRange: [6 * 60, 11 * 60] as const,
  // The night range crosses midnight. Night minutes count from noon, so 01:30 sorts after 23:50.
  nightRange: [21 * 60 + 30, 25 * 60 + 30] as const,
  minimumActiveDays: 7,
  quietMarginMinutes: 30,
  dailyLimit: 3,
  catchUpMs: 2 * 60 * 60 * 1000,
}

const minutesPerDay = 24 * 60

/** One activity day starts at the earliest greeting time. Minutes after the next midnight exceed 1440. */
export interface DayActivity {
  day: string
  first: number
  last: number
}

/** A routine that the app derives or the user adds. Derived routines change with activity and memory. */
export interface CharacterRoutine {
  id: string
  kind: 'morning-greeting' | 'night-reminder' | 'anniversary' | 'custom'
  /** `auto` routines come from activity or memory and change by themselves. `user` routines change only by the user. */
  origin: 'auto' | 'user'
  schedule: { type: 'daily', minute: number } | { type: 'yearly', month: number, day: number, minute: number }
  /** For an anniversary, the memory entry that holds the date. */
  sourceEpisodeId?: string
  /** The occasion in the words of the user, for example a custom routine or an anniversary fact. */
  note?: string
}

export interface QuietHours {
  /** Minutes after midnight. Quiet hours run from `start` to `end`, across midnight when `start` is later. */
  start: number
  end: number
}

/**
 * Formats a timestamp as the local calendar day.
 *
 * @example
 * localDay(new Date(2026, 9, 16, 23, 59).getTime())
 * // => '2026-10-16'
 */
export function localDay(at: number) {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function minuteOfDay(at: number) {
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

/** Records one interaction in the activity log. The log keeps the last 14 days. */
export function recordActivity(log: readonly DayActivity[], at: number): DayActivity[] {
  const date = new Date(at)
  let minute = minuteOfDay(at)
  // Activity before the earliest morning greeting belongs to the previous night, not to the next morning.
  if (minute < scheduleRules.morningRange[0]) {
    date.setDate(date.getDate() - 1)
    minute += minutesPerDay
  }
  const day = localDay(date.getTime())
  const today = log.find(entry => entry.day === day)
  const others = log.filter(entry => entry.day !== day)
  const updated = today
    ? { day, first: Math.min(today.first, minute), last: Math.max(today.last, minute) }
    : { day, first: minute, last: minute }
  return [...others, updated].sort((left, right) => left.day.localeCompare(right.day)).slice(-14)
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

function clamp(value: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, value))
}

/** Computes the times of the automatic greeting and reminder from the last 7 active days. */
export function automaticTimes(log: readonly DayActivity[]): { morning: number, night: number } {
  const recent = log.slice(-scheduleRules.minimumActiveDays)
  if (recent.length < scheduleRules.minimumActiveDays)
    return { morning: scheduleRules.defaultMorning, night: scheduleRules.defaultNight }

  const morning = clamp(median(recent.map(entry => entry.first)), scheduleRules.morningRange)
  // A last activity before noon belongs to the night before, so it counts after midnight.
  const nightFromNoon = recent.map(entry => entry.last < 12 * 60 ? entry.last + minutesPerDay : entry.last)
  const night = clamp(median(nightFromNoon), scheduleRules.nightRange) % minutesPerDay
  return { morning, night }
}

export function quietHoursFor(times: { morning: number, night: number }): QuietHours {
  return {
    start: (times.night + scheduleRules.quietMarginMinutes) % minutesPerDay,
    end: (times.morning - scheduleRules.quietMarginMinutes + minutesPerDay) % minutesPerDay,
  }
}

export function isQuiet(quiet: QuietHours, minute: number) {
  return quiet.start <= quiet.end
    ? minute >= quiet.start && minute < quiet.end
    : minute >= quiet.start || minute < quiet.end
}

/** The automatic greeting and reminder of the current activity log. */
export function automaticRoutines(log: readonly DayActivity[]): CharacterRoutine[] {
  const { morning, night } = automaticTimes(log)
  return [
    { id: 'morning-greeting', kind: 'morning-greeting', origin: 'auto', schedule: { type: 'daily', minute: morning } },
    { id: 'night-reminder', kind: 'night-reminder', origin: 'auto', schedule: { type: 'daily', minute: night } },
  ]
}

/** The time today at which a routine fires, or `undefined` when it does not fire today. */
function scheduledToday(routine: CharacterRoutine, at: number) {
  const date = new Date(at)
  if (routine.schedule.type === 'yearly' && (date.getMonth() + 1 !== routine.schedule.month || date.getDate() !== routine.schedule.day))
    return undefined
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(routine.schedule.minute / 60), routine.schedule.minute % 60).getTime()
}

export interface ProactiveHistory {
  /** When each routine last fired, by routine id. */
  lastFiredAt: Record<string, number>
  /** How many proactive messages each local day had. */
  firedPerDay: Record<string, number>
}

/**
 * Returns the routine that fires at `at`, or `undefined`.
 *
 * A routine fires once per scheduled time, at most `catchUpMs` late. Quiet hours and the daily limit stop every routine.
 * When several are due, the earliest scheduled one fires, and the others wait for later checks.
 */
export function dueRoutine(routines: readonly CharacterRoutine[], history: ProactiveHistory, quiet: QuietHours, at: number): CharacterRoutine | undefined {
  if ((history.firedPerDay[localDay(at)] ?? 0) >= scheduleRules.dailyLimit)
    return undefined
  if (isQuiet(quiet, minuteOfDay(at)))
    return undefined

  return routines
    .map(routine => ({ routine, scheduledAt: scheduledToday(routine, at) }))
    .filter((entry): entry is { routine: CharacterRoutine, scheduledAt: number } => entry.scheduledAt !== undefined
      && at >= entry.scheduledAt
      && at - entry.scheduledAt <= scheduleRules.catchUpMs
      && (history.lastFiredAt[entry.routine.id] ?? 0) < entry.scheduledAt)
    .sort((left, right) => left.scheduledAt - right.scheduledAt)[0]
    ?.routine
}

/** Records that a routine fired. */
export function recordFired(history: ProactiveHistory, routineId: string, at: number): ProactiveHistory {
  const day = localDay(at)
  return {
    lastFiredAt: { ...history.lastFiredAt, [routineId]: at },
    firedPerDay: { [day]: (history.firedPerDay[day] ?? 0) + 1 },
  }
}

/** One system notification that Android shows at `at`. */
export interface PlannedNotification {
  routine: CharacterRoutine
  at: number
}

/**
 * Plans the system notifications of the next `days` local days, starting at `from`.
 *
 * The plan follows the rules of {@link dueRoutine}, because Android shows these notifications while the app sleeps:
 * nothing in quiet hours, and at most 3 a day, counted together with the messages that already fired today.
 * A routine that already fired at its time today gets no notification. Each entry is a one-time notification,
 * so the plan must be rebuilt within `days`. The Pocket app rebuilds it on every change and when it returns to the foreground.
 */
export function planNotifications(routines: readonly CharacterRoutine[], history: ProactiveHistory, quiet: QuietHours, from: number, days = 7): PlannedNotification[] {
  const start = new Date(from)
  const plan: PlannedNotification[] = []
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 12).getTime()
    const alreadyFired = offset === 0 ? history.firedPerDay[localDay(from)] ?? 0 : 0
    const entries = routines
      .map(routine => ({ routine, at: scheduledToday(routine, day) }))
      .filter((entry): entry is PlannedNotification => entry.at !== undefined
        && entry.at > from
        && !isQuiet(quiet, entry.routine.schedule.minute)
        && (history.lastFiredAt[entry.routine.id] ?? 0) < entry.at)
      .sort((left, right) => left.at - right.at)
      .slice(0, Math.max(0, scheduleRules.dailyLimit - alreadyFired))
    plan.push(...entries)
  }
  return plan
}
