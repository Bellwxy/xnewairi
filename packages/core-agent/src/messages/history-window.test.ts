import { describe, expect, it } from 'vitest'

import { selectHistoryWindow } from './history-window'

const system = { role: 'system', id: 'system' }

function round(index: number) {
  return [
    { role: 'user', id: `user-${index}` },
    { role: 'assistant', id: `assistant-${index}` },
  ]
}

function ids(messages: Array<{ id: string }>) {
  return messages.map(message => message.id)
}

describe('selectHistoryWindow', () => {
  it('keeps only the most recent rounds and the system message', () => {
    const history = [system, ...Array.from({ length: 100 }, (_, index) => round(index)).flat()]

    const selected = selectHistoryWindow(history, 30)

    expect(selected).toHaveLength(61)
    expect(selected[0]).toBe(system)
    expect(selected[1]?.id).toBe('user-70')
    expect(selected.at(-1)?.id).toBe('assistant-99')
  })

  it('returns a copy of the full history when it has no more rounds than the limit', () => {
    const history = [system, ...round(1), ...round(2)]

    const selected = selectHistoryWindow(history, 2)

    expect(selected).toEqual(history)
    expect(selected).not.toBe(history)
  })

  it('never separates a tool call from its result', () => {
    const history = [
      ...round(1),
      { role: 'user', id: 'user-2' },
      { role: 'assistant', id: 'assistant-2-call' },
      { role: 'tool', id: 'tool-2' },
      { role: 'assistant', id: 'assistant-2-answer' },
    ]

    expect(ids(selectHistoryWindow(history, 1))).toEqual(['user-2', 'assistant-2-call', 'tool-2', 'assistant-2-answer'])
  })

  it('counts messages before the first user message as one round', () => {
    const history = [system, { role: 'assistant', id: 'greeting' }, ...round(1), ...round(2)]

    expect(ids(selectHistoryWindow(history, 3))).toEqual(['system', 'greeting', 'user-1', 'assistant-1', 'user-2', 'assistant-2'])
    expect(ids(selectHistoryWindow(history, 2))).toEqual(['system', 'user-1', 'assistant-1', 'user-2', 'assistant-2'])
  })

  it('keeps a proactive message in the round before it', () => {
    const history = [...round(1), { role: 'assistant', id: 'proactive' }, ...round(2)]

    expect(ids(selectHistoryWindow(history, 2))).toEqual(['user-1', 'assistant-1', 'proactive', 'user-2', 'assistant-2'])
    expect(ids(selectHistoryWindow(history, 1))).toEqual(['user-2', 'assistant-2'])
  })

  it('keeps a system message that appears after the window start', () => {
    const history = [...round(1), { role: 'system', id: 'late-system' }, ...round(2)]

    expect(ids(selectHistoryWindow(history, 1))).toEqual(['late-system', 'user-2', 'assistant-2'])
  })

  it('rejects a limit that is not a positive integer', () => {
    expect(() => selectHistoryWindow([], 0)).toThrow(RangeError)
    expect(() => selectHistoryWindow([], 1.5)).toThrow(RangeError)
  })
})
