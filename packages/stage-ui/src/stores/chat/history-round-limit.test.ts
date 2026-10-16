import { describe, expect, it } from 'vitest'

import { historyRoundLimitFor } from './history-round-limit'

describe('historyRoundLimitFor', () => {
  it('uses 30 rounds when the model reports no context length', () => {
    expect(historyRoundLimitFor(undefined)).toBe(30)
    expect(historyRoundLimitFor(0)).toBe(30)
  })

  it('derives the limit from half of the context', () => {
    expect(historyRoundLimitFor(32_000)).toBe(20)
    expect(historyRoundLimitFor(64_000)).toBe(40)
  })

  it('keeps the limit between 10 and 60 rounds', () => {
    expect(historyRoundLimitFor(8192)).toBe(10)
    expect(historyRoundLimitFor(128_000)).toBe(60)
    expect(historyRoundLimitFor(1_000_000)).toBe(60)
  })
})
