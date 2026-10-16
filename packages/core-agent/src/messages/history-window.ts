/**
 * Selects the session history that one request sends to the model. Stored messages do not change.
 *
 * A round starts at a user message. It owns every following assistant, tool, and error message
 * until the next user message, so a tool call and its result always stay together.
 * Messages before the first user message form one round, for example a greeting at the start of a session.
 * A proactive message without user input belongs to the round before it.
 * System messages keep their position and never count as a round.
 *
 * @example
 * selectHistoryWindow([system, user1, assistant1, user2, tool2, assistant2], 1)
 * // => [system, user2, tool2, assistant2]
 */
export function selectHistoryWindow<T extends { role: string }>(history: readonly T[], roundLimit: number): T[] {
  if (!Number.isInteger(roundLimit) || roundLimit < 1)
    throw new RangeError(`The history round limit must be a positive integer, got ${roundLimit}`)

  const roundStarts: number[] = []
  history.forEach((message, index) => {
    if (message.role === 'system')
      return
    if (message.role === 'user' || roundStarts.length === 0)
      roundStarts.push(index)
  })

  if (roundStarts.length <= roundLimit)
    return [...history]

  const firstKeptIndex = roundStarts[roundStarts.length - roundLimit]!
  return history.filter((message, index) => index >= firstKeptIndex || message.role === 'system')
}
