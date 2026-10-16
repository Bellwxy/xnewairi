/**
 * The window policy of spec 2.0. These are first values. The spec asks to calibrate them with Chinese samples.
 *
 * - Half of the context stays free for the system prompt, memory, tool results, and the reply.
 * - `tokensPerRound` estimates one round of companion chat, including its time prefix.
 * - The clamp keeps a small model in a usable conversation and keeps a large model from slow, costly requests.
 */
const windowPolicy = {
  historyShareOfContext: 0.5,
  tokensPerRound: 800,
  minRounds: 10,
  maxRounds: 60,
  /** Custom endpoints often do not report a context length. The model catalog then stores 0. */
  unknownContextRounds: 30,
}

/**
 * Returns how many recent rounds of history one chat request sends.
 * The number of rounds is not a token limit. One very long round can still exceed the context.
 *
 * @example
 * historyRoundLimitFor(128_000)
 * // => 60
 * historyRoundLimitFor(8192)
 * // => 10
 * historyRoundLimitFor(undefined)
 * // => 30
 */
export function historyRoundLimitFor(contextLength: number | undefined): number {
  if (!contextLength || contextLength <= 0)
    return windowPolicy.unknownContextRounds

  const rounds = Math.floor(contextLength * windowPolicy.historyShareOfContext / windowPolicy.tokensPerRound)
  return Math.min(windowPolicy.maxRounds, Math.max(windowPolicy.minRounds, rounds))
}
