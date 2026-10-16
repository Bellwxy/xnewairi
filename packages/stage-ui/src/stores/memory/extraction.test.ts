import type { ChatHistoryItem } from '../../types/chat'

import { describe, expect, it } from 'vitest'

import { backfillBatchCount, buildExtractionRequest, nextBatch, parseExtractionReply, pendingRoundCount } from './extraction'
import { backfillSession, commitExtraction, createMemoryDocument, setCoreBlockLock } from './memory-document'

const at = new Date(2026, 9, 16, 9, 0).getTime()
const minute = 60 * 1000
const day = 24 * 60 * minute
const scope = { accountId: 'local', characterId: 'mio', sessionId: 'session-a' }

function round(index: number, createdAt = at - (100 - index) * minute): ChatHistoryItem[] {
  return [
    { role: 'user', content: `question ${index}`, id: `u${index}`, createdAt },
    { role: 'assistant', content: `answer ${index}`, slices: [], tool_results: [], id: `a${index}`, createdAt: createdAt + 1000 },
  ]
}

const system: ChatHistoryItem = { role: 'system', content: 'system prompt', id: 'system', createdAt: 0 }

describe('nextBatch', () => {
  it('reads complete rounds and skips the round that waits for its reply', async () => {
    const messages = [system, ...round(1), ...round(2), { role: 'user', content: 'still typing', id: 'u3', createdAt: at } satisfies ChatHistoryItem]

    const batch = await nextBatch(scope, createMemoryDocument('mio', at), messages)

    expect(batch?.messageIds).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('reads at most 20 rounds in one batch', async () => {
    const messages = Array.from({ length: 30 }, (_, index) => round(index)).flat()

    const batch = await nextBatch(scope, createMemoryDocument('mio', at), messages)

    expect(batch?.messageIds).toHaveLength(40)
    expect(pendingRoundCount(createMemoryDocument('mio', at), 'session-a', messages)).toBe(30)
  })

  it('skips messages older than 7 days unless the session is backfilled', async () => {
    const old = round(1, at - 8 * day)
    const document = createMemoryDocument('mio', at)

    expect(await nextBatch(scope, document, old)).toBeUndefined()
    expect((await nextBatch(scope, backfillSession(document, 'session-a'), old))?.messageIds).toEqual(['u1', 'a1'])
  })

  it('counts the batches of a manual backfill', () => {
    const old = Array.from({ length: 45 }, (_, index) => round(index, at - 30 * day + index * minute)).flat()

    expect(backfillBatchCount(createMemoryDocument('mio', at), 'session-a', old)).toBe(3)
  })

  it('gives a forked copy the same batch id, so it commits only once', async () => {
    const messages = [...round(1), ...round(2)]
    const document = createMemoryDocument('mio', at)

    const original = await nextBatch(scope, document, messages)
    const forked = await nextBatch({ ...scope, sessionId: 'session-fork' }, document, messages)

    expect(forked?.batchId).toBe(original?.batchId)
  })

  it('gives nothing after the messages were extracted', async () => {
    const messages = [...round(1)]
    const document = createMemoryDocument('mio', at)
    const batch = (await nextBatch(scope, document, messages))!
    const committed = commitExtraction(document, {
      batchId: batch.batchId,
      generation: 0,
      sessionId: 'session-a',
      messageIds: batch.messageIds,
      readAt: at,
      coreBlocks: {},
      episodes: [],
      candidateIds: [],
      affectionDelta: 0,
    }, at).document

    expect(await nextBatch(scope, committed, messages)).toBeUndefined()
  })
})

describe('buildExtractionRequest', () => {
  it('marks locked core blocks and sends the messages as data', async () => {
    const document = setCoreBlockLock(createMemoryDocument('mio', at), 'user-profile', true)
    const batch = (await nextBatch(scope, document, round(1)))!

    const request = buildExtractionRequest(document, batch, at)
    const userTurn = request.conversation.turns[1]
    const input = JSON.parse(userTurn?.type === 'user' && userTurn.content[0]?.type === 'text' ? userTurn.content[0].text : '{}')

    expect(input.coreBlocks['user-profile'].locked).toBe(true)
    expect(input.messages.map((message: { id: string }) => message.id)).toEqual(['u1', 'a1'])
    expect(input.messages[1].role).toBe('character')
  })
})

describe('parseExtractionReply', () => {
  async function prepared() {
    const document = createMemoryDocument('mio', at)
    const batch = (await nextBatch(scope, document, round(1)))!
    return { document, batch }
  }

  it('assigns ids and keeps the batch identity of the app', async () => {
    const { document, batch } = await prepared()
    const reply = JSON.stringify({
      coreBlocks: { 'user-profile': 'The user is Ren.' },
      episodes: [{ text: 'The user was born on 3 May.', factKey: 'user.birthday', importance: 0.9, keywords: ['birthday'], occurredAt: null, annualDate: { month: 5, day: 3 }, replaces: [] }],
      affectionDelta: 3,
    })

    const parsed = parseExtractionReply(`\`\`\`json\n${reply}\n\`\`\``, document, batch, [], at)

    expect(parsed.affectionDelta).toBe(3)
    expect(parsed.batchId).toBe(batch.batchId)
    expect(parsed.messageIds).toEqual(['u1', 'a1'])
    expect(parsed.coreBlocks).toEqual({ 'user-profile': 'The user is Ren.' })
    expect(parsed.episodes[0]).toMatchObject({ factKey: 'user.birthday', annualDate: { month: 5, day: 3 } })
    expect(parsed.episodes[0]?.id).toEqual(expect.any(String))
  })

  it('drops an unknown fact key and an empty episode', async () => {
    const { document, batch } = await prepared()
    const reply = JSON.stringify({
      episodes: [
        { text: 'The user likes jazz.', factKey: 'made.up', importance: 0.4, keywords: [], occurredAt: null, annualDate: null, replaces: [] },
        { text: '  ', factKey: null, importance: 0.1, keywords: [], occurredAt: null, annualDate: null, replaces: [] },
      ],
    })

    const parsed = parseExtractionReply(reply, document, batch, [], at)

    expect(parsed.episodes).toHaveLength(1)
    expect(parsed.episodes[0]?.factKey).toBeUndefined()
    expect(parsed.affectionDelta).toBe(0)
  })

  it('parses a known date as the local day', async () => {
    const { document, batch } = await prepared()
    const reply = JSON.stringify({ episodes: [{ text: 'The user moved.', factKey: null, importance: 0.5, keywords: [], occurredAt: '2026-05-03', annualDate: null, replaces: [] }] })

    expect(parseExtractionReply(reply, document, batch, [], at).episodes[0]?.occurredAt).toBe(new Date(2026, 4, 3).getTime())
  })

  it('rejects an affection delta outside -10 to 10 and a reply that is not JSON', async () => {
    const { document, batch } = await prepared()

    expect(() => parseExtractionReply(JSON.stringify({ episodes: [], affectionDelta: 50 }), document, batch, [], at)).toThrow()
    expect(() => parseExtractionReply('Sure, here you go.', document, batch, [], at)).toThrow()
  })
})
