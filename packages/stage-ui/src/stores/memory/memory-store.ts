import type { Conversation } from '@proj-airi/core-agent'

import type { CoreMemoryBlockKey } from './memory-document'

import { errorMessageFrom } from '@moeru/std'
import { getAccountScope } from '@proj-airi/stage-shared/account-scope/runtime'
import { useDocumentVisibility } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { useLLM } from '../ai/chat-llm/llm'
import { useCharacterStateStore } from '../character/state'
import { useChatSessionStore } from '../chat/session-store'
import { useAiriCardStore } from '../modules/airi-card'
import { useProviderStore } from '../providers/provider'
import { useMemoryEmbedding } from './embedding'
import { buildExtractionRequest, nextBatch, parseExtractionReply, pendingRoundCount } from './extraction'
import {
  acknowledgeAffectionEvents,
  backfillSession as backfillSessionOf,
  clearMemory as clearMemoryOf,
  commitExtraction,
  deleteEpisode as deleteEpisodeOf,
  editCoreBlock as editCoreBlockOf,
  setCoreBlockLock as setCoreBlockLockOf,
  validEpisodes,
} from './memory-document'
import { useMemorySettingsStore } from './memory-settings'
import { renderMemoryContext, selectEpisodes } from './recall'

/**
 * What the memory page shows for one character. Only `attention` asks the user to act.
 *
 * - `idle`: every waiting round is in memory.
 * - `working`: an extraction runs or waits for its retry.
 * - `quota`: the daily call limit stopped extraction until the next local day.
 * - `attention`: no model is set, the retries ran out, or an extraction provider needs consent.
 */
export interface MemoryStatus {
  state: 'idle' | 'working' | 'quota' | 'attention'
  reason?: 'no-model' | 'failed' | 'consent'
}

/**
 * Scheduling rules of spec 2.1.
 *
 * - `roundsBeforeExtraction` complete rounds start an extraction at once.
 * - `idleMs` after the last round of a session also starts one.
 * - A failed extraction retries after each `retryDelaysMs` entry, then waits for the user.
 * - A new session waits at most `newSessionWaitMs` for a running extraction of its character.
 */
const scheduleRules = {
  roundsBeforeExtraction: 20,
  idleMs: 10 * 60 * 1000,
  retryDelaysMs: [30_000, 2 * 60_000, 10 * 60_000],
  newSessionWaitMs: 3000,
  extractionTimeoutMs: 90_000,
  queryEmbeddingTimeoutMs: 3000,
  recentSessionMs: 7 * 24 * 60 * 60 * 1000,
  embeddingBatchSize: 32,
}

/**
 * Long-term memory of every character.
 *
 * The chat leader runs extraction: it reads persisted messages, asks a model, and commits the result to the account
 * database. Every window reads the database directly, and `revisions` tells them when to read again.
 * Writes from the memory page also run in the leader, so they share its queue with extraction.
 *
 * Lifecycle: the chat store calls `start` when its window becomes the leader and `stop` when it stops being one.
 * Work that runs during `stop` finishes its model request, but it does not commit.
 */
export const useCharacterMemoryStore = defineStore('character-memory', () => {
  /** Synchronized: the status of each character, written by the leader. */
  const statuses = ref<Record<string, MemoryStatus>>({})
  /** Synchronized: the latest committed revision of each character. A view reads the record again when it grows. */
  const revisions = ref<Record<string, number>>({})

  // The rest is runtime state of the leader. It is not synchronized and starts empty in every window.
  let running = false
  /**
   * Increments when all memory is deleted. Work that started in an older epoch does not commit,
   * even when it finishes after the deletion.
   */
  let epoch = 0
  /** One promise chain per character, so the extractions and edits of one character never overlap. */
  const queues = new Map<string, Promise<void>>()
  const busyCharacters = new Set<string>()
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const retries = new Map<string, { attempts: number, timer?: ReturnType<typeof setTimeout> }>()
  let stopVisibilityListener: (() => void) | undefined

  const settings = useMemorySettingsStore()
  const cards = useAiriCardStore()
  const chatSession = useChatSessionStore()
  const characterState = useCharacterStateStore()
  const llm = useLLM()
  const providers = useProviderStore()
  const embedding = useMemoryEmbedding()
  const visibility = useDocumentVisibility()

  function setStatus(characterId: string, status: MemoryStatus) {
    statuses.value = { ...statuses.value, [characterId]: status }
  }

  function noteRevision(characterId: string, revision: number) {
    revisions.value = { ...revisions.value, [characterId]: revision }
  }

  function chatModelOf(characterId: string) {
    return cards.getModules(characterId).consciousness
  }

  /**
   * The model that extracts memory of a character. The advanced override wins. Otherwise the chat model of the character
   * extracts, so chats reach no provider that the user did not already choose.
   */
  function extractionModelOf(characterId: string) {
    const chat = chatModelOf(characterId)
    if (!settings.hasExtractionOverride)
      return { ...chat, needsConsent: false }
    const override = settings.extractionOverride
    return {
      ...override,
      needsConsent: override.provider !== chat.provider && !settings.confirmedExtractionProviders.includes(override.provider),
    }
  }

  function enqueue(characterId: string, work: () => Promise<void>) {
    const run = async () => {
      busyCharacters.add(characterId)
      try {
        await work()
      }
      finally {
        busyCharacters.delete(characterId)
      }
    }
    const tail = (queues.get(characterId) ?? Promise.resolve()).then(run, run)
    queues.set(characterId, tail.catch(() => {}))
    return tail
  }

  async function requestReply(selection: { provider: string, model: string }, conversation: Conversation, signal: AbortSignal) {
    const provider = await providers.getChatProviderInstance(selection.provider)
    let reply = ''
    await llm.stream(selection.model, provider, conversation, {
      // Extraction calls no tools. A provider without tool calling rejects a tool list.
      supportsTools: false,
      abortSignal: signal,
      onStreamEvent: (event) => {
        if (event.type === 'text-delta')
          reply += event.text
      },
    })
    return reply
  }

  function hasPendingRetry(characterId: string) {
    return [...retries.keys()].some(key => JSON.parse(key)[0] === characterId)
  }

  function scheduleRetry(characterId: string, sessionId: string, error: unknown) {
    const key = JSON.stringify([characterId, sessionId])
    const retry = retries.get(key) ?? { attempts: 0 }
    const delay = scheduleRules.retryDelaysMs[retry.attempts]
    console.warn('[memory] Extraction failed:', errorMessageFrom(error))
    if (delay === undefined) {
      setStatus(characterId, { state: 'attention', reason: 'failed' })
      return
    }
    clearTimeout(retry.timer)
    retry.attempts++
    retry.timer = setTimeout(scheduleSession, delay, characterId, sessionId)
    retries.set(key, retry)
    setStatus(characterId, { state: 'working' })
  }

  /**
   * Extracts every waiting batch of one session, one batch after another, until none waits or a limit stops it.
   * `scheduledIn` is the epoch when the work was queued. Work queued before "Delete all data" never runs after it.
   */
  async function extractSession(characterId: string, sessionId: string, scheduledIn: number) {
    const startedIn = scheduledIn
    for (;;) {
      // `stop`, "Delete all data", and the settings change between batches, so each batch checks them again.
      if (!running || epoch !== startedIn || !settings.enabled)
        return
      if (!settings.canSpendCall()) {
        setStatus(characterId, { state: 'quota' })
        return
      }

      let selection: ReturnType<typeof extractionModelOf>
      try {
        selection = extractionModelOf(characterId)
      }
      catch {
        // The character was deleted while its work waited in the queue.
        return
      }
      if (!selection.provider || !selection.model) {
        setStatus(characterId, { state: 'attention', reason: 'no-model' })
        return
      }
      if (selection.needsConsent) {
        setStatus(characterId, { state: 'attention', reason: 'consent' })
        return
      }

      // Extraction reads only persisted messages. A turn that is still in memory waits for the next run.
      const record = await chatSessionsRepo.getSession(sessionId)
      if (!record || record.meta.characterId !== characterId)
        return

      const document = await characterMemoryRepo.getOrCreate(characterId)
      const batch = await nextBatch({ accountId: getAccountScope().accountId, characterId, sessionId }, document, record.messages)
      if (!batch) {
        retries.delete(JSON.stringify([characterId, sessionId]))
        // The status belongs to the character. Another session of it can still wait for a retry.
        if (statuses.value[characterId]?.state === 'working' && !hasPendingRetry(characterId))
          setStatus(characterId, { state: 'idle' })
        return
      }

      setStatus(characterId, { state: 'working' })
      const readAt = Date.now()
      const request = buildExtractionRequest(document, batch, readAt)
      await settings.spendCall()

      let commit: ReturnType<typeof parseExtractionReply>
      try {
        const reply = await requestReply(selection, request.conversation, AbortSignal.timeout(scheduleRules.extractionTimeoutMs))
        commit = parseExtractionReply(reply, document, batch, request.candidates, readAt)
      }
      catch (error) {
        scheduleRetry(characterId, sessionId, error)
        return
      }

      // A window that lost leadership must not write a result that the new leader may also produce.
      // A deletion during the request also ends the work.
      if (!running || epoch !== startedIn)
        return

      // The commit never creates a record. A record that a deletion removed during the request stays removed.
      const next = await characterMemoryRepo.updateExisting(characterId, current => commitExtraction(current, commit, Date.now()).document)
      if (!next)
        return
      noteRevision(characterId, next.revision)
      retries.delete(JSON.stringify([characterId, sessionId]))

      await applyPendingAffection(characterId)
      // Vectors come after the commit. Their failure never undoes the text.
      void updateVectors(characterId).catch(error => console.warn('[memory] Failed to compute vectors:', errorMessageFrom(error)))
    }
  }

  /**
   * Applies the affection events that commits left in the record, then removes them from it.
   * The character state dedupes by batch id, so a crash between the two steps applies no event twice.
   */
  async function applyPendingAffection(characterId: string) {
    const document = await characterMemoryRepo.get(characterId)
    const events = document?.pendingAffectionEvents ?? []
    if (!events.length)
      return
    for (const event of events)
      await characterState.applyAffectionDelta(characterId, event.batchId, event.delta)
    await characterMemoryRepo.updateExisting(characterId, current => acknowledgeAffectionEvents(current, events.map(event => event.batchId)))
  }

  /** Computes vectors for valid episodes that lack one in the active vector space. */
  async function updateVectors(characterId: string) {
    const chat = chatModelOf(characterId)
    const target = await embedding.resolveTarget(chat.provider, chat.model)
    if (!target)
      return

    const document = await characterMemoryRepo.get(characterId)
    if (!document)
      return
    const stored = await characterMemoryRepo.getVectors(characterId)
    const known = stored?.model === target.version ? stored.vectors : {}
    const missing = validEpisodes(document).filter(episode => !known[episode.id])
    for (let index = 0; index < missing.length; index += scheduleRules.embeddingBatchSize) {
      const chunk = missing.slice(index, index + scheduleRules.embeddingBatchSize)
      const vectors = await embedding.embedTexts(target, chunk.map(episode => episode.text))
      await characterMemoryRepo.putVectors(characterId, target.version, Object.fromEntries(chunk.map((episode, offset) => [episode.id, vectors[offset]!])))
    }
  }

  function scheduleSession(characterId: string, sessionId: string) {
    const scheduledIn = epoch
    void enqueue(characterId, () => extractSession(characterId, sessionId, scheduledIn))
  }

  /** Queues every session that changed in the last 7 days or that the user backfilled. Recovers work that a restart lost. */
  async function scan(characterId?: string) {
    if (!running || !settings.enabled)
      return
    const recent = Date.now() - scheduleRules.recentSessionMs
    for (const meta of Object.values(chatSession.sessionMetas)) {
      if (characterId && meta.characterId !== characterId)
        continue
      const document = await characterMemoryRepo.get(meta.characterId)
      if (meta.updatedAt >= recent || document?.backfilledSessionIds.includes(meta.sessionId))
        scheduleSession(meta.characterId, meta.sessionId)
    }
  }

  /**
   * Starts extraction in this window. Only the chat leader calls it. Calling it again does nothing.
   * The first scan waits for the session index, because the scan reads the sessions from it.
   */
  async function start() {
    if (running)
      return
    running = true
    await chatSession.initialize()
    if (!running)
      return
    // A crash after a commit can leave affection events in the records. They apply before any new work.
    for (const characterId of await characterMemoryRepo.listCharacterIds())
      await applyPendingAffection(characterId)
    // Android stops background timers. Returning to the foreground recovers the work they missed.
    stopVisibilityListener = watch(visibility, (state) => {
      if (state === 'visible')
        void scan().catch(error => console.warn('[memory] Scan failed:', errorMessageFrom(error)))
    })
    await scan()
  }

  /** Stops extraction in this window. Running model requests finish, but their results are not committed. */
  async function stop() {
    running = false
    stopVisibilityListener?.()
    stopVisibilityListener = undefined
    for (const timer of idleTimers.values())
      clearTimeout(timer)
    idleTimers.clear()
    for (const retry of retries.values())
      clearTimeout(retry.timer)
    retries.clear()
  }

  /** Called by the chat leader after a completed round. Starts at 20 waiting rounds, or after 10 idle minutes. */
  async function noteRoundFinished(sessionId: string) {
    const characterId = chatSession.sessionMetas[sessionId]?.characterId
    if (!running || !settings.enabled || !characterId)
      return

    clearTimeout(idleTimers.get(sessionId))
    idleTimers.set(sessionId, setTimeout(() => {
      idleTimers.delete(sessionId)
      scheduleSession(characterId, sessionId)
    }, scheduleRules.idleMs))

    const document = await characterMemoryRepo.getOrCreate(characterId)
    if (pendingRoundCount(document, sessionId, chatSession.getSessionMessages(sessionId)) >= scheduleRules.roundsBeforeExtraction)
      scheduleSession(characterId, sessionId)
  }

  /** Called by the chat leader when the user leaves a session. Its complete rounds go to memory at once. */
  async function noteSessionLeft(sessionId: string) {
    const characterId = chatSession.sessionMetas[sessionId]?.characterId
    if (!running || !settings.enabled || !characterId)
      return
    clearTimeout(idleTimers.get(sessionId))
    idleTimers.delete(sessionId)
    scheduleSession(characterId, sessionId)
  }

  /** Waits until the queue of a character is empty, or until `timeoutMs` passes. */
  async function waitForCharacter(characterId: string, timeoutMs: number) {
    const queue = queues.get(characterId)
    if (!queue || !busyCharacters.has(characterId))
      return
    await Promise.race([queue, new Promise(resolve => setTimeout(resolve, timeoutMs))])
  }

  /**
   * Builds the memory context of one request. The chat store calls it after the request leaves the session queue.
   * A failure gives no memory, so memory never blocks chat.
   */
  async function recallContext(characterId: string, query: string, options: { newSession: boolean }) {
    if (!settings.enabled)
      return ''
    try {
      // A new session can need what the previous session just said, so it waits a little for the running extraction.
      if (options.newSession)
        await waitForCharacter(characterId, scheduleRules.newSessionWaitMs)

      const document = await characterMemoryRepo.get(characterId)
      if (!document)
        return ''

      const chat = chatModelOf(characterId)
      const target = await embedding.resolveTarget(chat.provider, chat.model)
      const stored = target ? await characterMemoryRepo.getVectors(characterId) : null
      let queryVector: number[] | undefined
      if (target && stored?.model === target.version && query.trim()) {
        queryVector = await embedding.embedTexts(target, [query], AbortSignal.timeout(scheduleRules.queryEmbeddingTimeoutMs))
          .then(([vector]) => vector)
          .catch(() => undefined)
      }

      const vectors = queryVector && stored ? new Map(Object.entries(stored.vectors)) : undefined
      // The embedding request can take seconds. An edit or a deletion in that time must reach this request,
      // so the record is read again and the selection repeats until the revision holds.
      let current = document
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await characterMemoryRepo.get(characterId)
        if (!latest)
          return ''
        if (latest.revision === current.revision)
          break
        current = latest
      }
      return renderMemoryContext(current, selectEpisodes(current, { query, queryVector, vectors, at: Date.now() }))
    }
    catch (error) {
      console.warn('[memory] Recall failed, so the request has no memory:', errorMessageFrom(error))
      return ''
    }
  }

  async function applyEdit(characterId: string, change: Parameters<typeof characterMemoryRepo.update>[1]) {
    await enqueue(characterId, async () => {
      const next = await characterMemoryRepo.update(characterId, change)
      noteRevision(characterId, next.revision)
    })
  }

  async function deleteEpisode(characterId: string, episodeId: string) {
    await applyEdit(characterId, document => deleteEpisodeOf(document, episodeId))
    await characterMemoryRepo.deleteVectors(characterId, [episodeId])
  }

  async function editCoreBlock(characterId: string, key: CoreMemoryBlockKey, text: string) {
    await applyEdit(characterId, document => editCoreBlockOf(document, key, text, Date.now()))
  }

  async function setCoreBlockLock(characterId: string, key: CoreMemoryBlockKey, locked: boolean) {
    await applyEdit(characterId, document => setCoreBlockLockOf(document, key, locked))
  }

  /** Clears all memory of a character. Chats and the personality stay. Old messages are not extracted again. */
  async function clear(characterId: string) {
    await applyEdit(characterId, document => clearMemoryOf(document, Date.now()))
    await characterMemoryRepo.clearVectors(characterId)
    setStatus(characterId, { state: 'idle' })
  }

  /** Lets extraction read the whole history of a session. The memory page shows the expected batch count first. */
  async function backfillSession(characterId: string, sessionId: string) {
    await applyEdit(characterId, document => backfillSessionOf(document, sessionId))
    scheduleSession(characterId, sessionId)
  }

  /** Starts extraction of a character now, for example after the user fixed the model or ran out of retries. */
  async function extractNow(characterId: string) {
    for (const [key, retry] of retries) {
      if (JSON.parse(key)[0] === characterId) {
        clearTimeout(retry.timer)
        retries.delete(key)
      }
    }
    setStatus(characterId, { state: 'idle' })
    await scan(characterId)
  }

  /** Records consent for a provider that is not the chat provider, then extracts. */
  async function confirmExtractionProvider(characterId: string, provider: string) {
    await settings.confirmExtractionProvider(provider)
    await extractNow(characterId)
  }

  /**
   * Deletes the memory of every character. "Delete all data" calls it.
   * Running work ends without a commit, timers stop, and records that work writes later are not created again.
   */
  async function clearAll() {
    epoch++
    for (const timer of idleTimers.values())
      clearTimeout(timer)
    idleTimers.clear()
    for (const retry of retries.values())
      clearTimeout(retry.timer)
    retries.clear()
    await characterMemoryRepo.clearAll()
    statuses.value = {}
    revisions.value = {}
  }

  function resetState() {
    statuses.value = {}
    revisions.value = {}
  }

  return {
    statuses,
    revisions,
    start,
    stop,
    noteRoundFinished,
    noteSessionLeft,
    recallContext,
    deleteEpisode,
    editCoreBlock,
    setCoreBlockLock,
    clear,
    backfillSession,
    extractNow,
    confirmExtractionProvider,
    clearAll,
    resetState,
  }
}, {
  synced: {
    actions: ['deleteEpisode', 'editCoreBlock', 'setCoreBlockLock', 'clear', 'backfillSession', 'extractNow', 'confirmExtractionProvider', 'clearAll'],
    state: true,
  },
})
