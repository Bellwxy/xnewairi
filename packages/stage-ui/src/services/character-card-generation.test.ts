import type { Conversation } from '@proj-airi/core-agent'

import type { RequestReply } from './character-card-generation'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateCharacterFields } from './character-card-generation'

const brief = { name: 'Mio', summary: 'A gentle senior who teases a little.', language: 'zh-Hans' }

const validFields = {
  description: 'Your name is Mio.',
  personality: 'Calm and caring.',
  scenario: 'You study together after class.',
  greeting: 'You came! Shall we start?',
}

function textOf(conversation: Conversation, index: number) {
  const turn = conversation.turns[index]
  if (turn?.type === 'assistant')
    throw new Error('Generation never sends an assistant turn')
  const segment = turn?.content[0]
  return segment?.type === 'text' ? segment.text : ''
}

describe('generateCharacterFields', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the fields of a valid reply', async () => {
    const requestReply = vi.fn<RequestReply>(async () => JSON.stringify(validFields))

    await expect(generateCharacterFields(brief, requestReply)).resolves.toEqual(validFields)
  })

  it('reads a reply in a Markdown code fence', async () => {
    const requestReply = vi.fn<RequestReply>(async () => `\`\`\`json\n${JSON.stringify(validFields)}\n\`\`\``)

    await expect(generateCharacterFields(brief, requestReply)).resolves.toEqual(validFields)
  })

  it('sends the brief as data and asks for the interface language', async () => {
    const requestReply = vi.fn<RequestReply>(async () => JSON.stringify(validFields))

    await generateCharacterFields(brief, requestReply)

    const conversation = requestReply.mock.calls[0]![0]
    expect(conversation.turns[0]?.type).toBe('system')
    expect(textOf(conversation, 0)).toContain('BCP 47 tag: zh-Hans')
    expect(conversation.turns[1]?.type).toBe('user')
    expect(JSON.parse(textOf(conversation, 1))).toEqual({ name: 'Mio', summary: 'A gentle senior who teases a little.' })
  })

  it('rejects a reply that is not JSON', async () => {
    const requestReply = vi.fn<RequestReply>(async () => 'Sure! Here is your character.')

    await expect(generateCharacterFields(brief, requestReply)).rejects.toThrow()
  })

  it('rejects a reply with an empty field', async () => {
    const requestReply = vi.fn<RequestReply>(async () => JSON.stringify({ ...validFields, greeting: '   ' }))

    await expect(generateCharacterFields(brief, requestReply)).rejects.toThrow()
  })

  it('rejects a personality over 2000 code points instead of cutting it', async () => {
    // Each emoji is one code point and two UTF-16 units, so the limit counts code points.
    const requestReply = vi.fn<RequestReply>(async () => JSON.stringify({ ...validFields, personality: '😀'.repeat(2001) }))

    await expect(generateCharacterFields(brief, requestReply)).rejects.toThrow()
  })

  it('accepts a personality of exactly 2000 code points', async () => {
    const personality = '😀'.repeat(2000)
    const requestReply = vi.fn<RequestReply>(async () => JSON.stringify({ ...validFields, personality }))

    await expect(generateCharacterFields(brief, requestReply)).resolves.toEqual({ ...validFields, personality })
  })

  it('rejects when the request fails', async () => {
    const requestReply = vi.fn<RequestReply>(async () => {
      throw new Error('401 Unauthorized')
    })

    await expect(generateCharacterFields(brief, requestReply)).rejects.toThrow('401 Unauthorized')
  })

  it('rejects and aborts the request when the timeout ends', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    // This request never settles, so only the timeout can end generation.
    const requestReply = vi.fn<RequestReply>((_conversation, signal) => {
      requestSignal = signal
      return new Promise<string>(() => {})
    })

    const generation = generateCharacterFields(brief, requestReply, { timeoutMs: 20_000 })
    const assertion = expect(generation).rejects.toThrow('timed out after 20000ms')
    await vi.advanceTimersByTimeAsync(20_000)

    await assertion
    expect(requestSignal?.aborted).toBe(true)
  })

  it('rejects at once when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Step closed'))
    const requestReply = vi.fn<RequestReply>(() => new Promise<string>(() => {}))

    await expect(generateCharacterFields(brief, requestReply, { signal: controller.signal })).rejects.toThrow('Step closed')
  })
})
