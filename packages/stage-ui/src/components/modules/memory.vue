<script setup lang="ts">
import type { CharacterMemoryDocument, CoreMemoryBlockKey, EpisodeMemory } from '../../stores/memory/memory-document'
import type { EmbeddingMode } from '../../stores/memory/memory-settings'

import { Button, Collapsible, DoubleCheckButton, FieldCheckbox, FieldInput, FieldSelect, IconButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { characterMemoryRepo } from '../../database/repos/character-memory.repo'
import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { backfillBatchCount } from '../../stores/memory/extraction'
import { coreMemoryBlockKeys, validEpisodes } from '../../stores/memory/memory-document'
import { useMemorySettingsStore } from '../../stores/memory/memory-settings'
import { useCharacterMemoryStore } from '../../stores/memory/memory-store'
import { useAiriCardStore } from '../../stores/modules/airi-card'

const { t } = useI18n()
const settings = useMemorySettingsStore()
const { enabled, extractionOverride, embeddingMode, embeddingOverride, embeddingDetection } = storeToRefs(settings)
const memory = useCharacterMemoryStore()
const { statuses, revisions } = storeToRefs(memory)
const cardStore = useAiriCardStore()
const { cards, activeCardId } = storeToRefs(cardStore)
const chatSession = useChatSessionStore()

/** The character whose memory the page shows. It starts at the selected card. */
const characterId = ref(activeCardId.value)
const characterOptions = computed(() => [...cards.value.entries()].map(([id, card]) => ({ label: card.name, value: id })))

/** A copy of the stored record. The page reads it again after each change in any window. */
const memoryDocument = ref<CharacterMemoryDocument | null>(null)
const vectorModel = ref<string>()

async function reload() {
  const id = characterId.value
  const [document, vectors] = await Promise.all([characterMemoryRepo.get(id), characterMemoryRepo.getVectors(id)])
  // A slow read must not show the record of a character that the user left.
  if (id !== characterId.value)
    return
  memoryDocument.value = document
  vectorModel.value = vectors?.model
  await loadBackfillOptions()
}

watch([characterId, () => revisions.value[characterId.value]], () => void reload(), { immediate: true })
const stopListening = characterMemoryRepo.onChange((change) => {
  if (change.characterId === characterId.value)
    void reload()
})
onBeforeUnmount(stopListening)

const status = computed(() => statuses.value[characterId.value] ?? { state: 'idle' as const })
const statusText = computed(() => {
  if (status.value.state === 'attention')
    return t(`settings.pages.modules.memory-long-term.status.${status.value.reason ?? 'failed'}`)
  return t(`settings.pages.modules.memory-long-term.status.${status.value.state}`)
})

function byDateDesc(left: EpisodeMemory, right: EpisodeMemory) {
  return (right.occurredAt ?? right.createdAt) - (left.occurredAt ?? left.createdAt)
}

const episodes = computed(() => memoryDocument.value ? validEpisodes(memoryDocument.value).sort(byDateDesc) : [])
const replacedEpisodes = computed(() => (memoryDocument.value?.episodes ?? []).filter(episode => episode.invalidatedAt).sort(byDateDesc))
const coreBlocks = computed(() => coreMemoryBlockKeys
  .map(key => ({ key, text: memoryDocument.value?.coreBlocks[key].text ?? '', locked: memoryDocument.value?.coreBlocks[key].lockedByUser ?? false })))
const hasMemory = computed(() => episodes.value.length > 0 || coreBlocks.value.some(block => block.text))

function formatDay(at: number) {
  return new Date(at).toLocaleDateString()
}

async function clearBlock(key: CoreMemoryBlockKey) {
  await memory.editCoreBlock(characterId.value, key, '')
}

/** Drafts of the advanced core memory editor, filled from the stored record when it changes. */
const coreDrafts = ref<Record<CoreMemoryBlockKey, string>>({ 'user-profile': '', 'relationship': '' })
watch(coreBlocks, (blocks) => {
  coreDrafts.value = Object.fromEntries(blocks.map(block => [block.key, block.text])) as Record<CoreMemoryBlockKey, string>
}, { immediate: true })

const embeddingModeOptions = computed(() => (['auto', 'custom', 'off'] as const).map(mode => ({
  label: t(`settings.pages.modules.memory-long-term.embedding.${mode}`),
  value: mode,
})))
// The settings store is synchronized. Pages write through its actions, so the leader applies each change once.
const enabledModel = computed({
  get: () => enabled.value,
  set: (value: boolean) => void settings.setEnabled(value),
})
const embeddingModeModel = computed({
  get: () => embeddingMode.value,
  set: (mode: EmbeddingMode) => void settings.setEmbeddingMode(mode),
})

const chatProviderOfCharacter = computed(() => {
  try {
    return cardStore.getModules(characterId.value).consciousness.provider
  }
  catch {
    return ''
  }
})

/**
 * Edits the model of an override. The gateway is the only LLM provider, so the override always uses the chat provider of the character.
 * An empty model also clears the provider, so the automatic value applies again.
 */
function overrideModel(source: typeof extractionOverride, save: typeof settings.setExtractionOverride) {
  return computed({
    get: () => source.value.model,
    set: (model: string) => void save({ provider: model.trim() ? chatProviderOfCharacter.value : '', model }),
  })
}

const currentSearch = computed(() => {
  const model = embeddingMode.value === 'off' ? '' : (vectorModel.value?.split('|').at(-1) ?? embeddingDetection.value?.model ?? '')
  return model
    ? t('settings.pages.modules.memory-long-term.embedding.current-vector', { model })
    : t('settings.pages.modules.memory-long-term.embedding.current-keyword')
})

const extractionModel = overrideModel(extractionOverride, settings.setExtractionOverride)
const embeddingModel = overrideModel(embeddingOverride, settings.setEmbeddingOverride)

/** Sessions of the character with history that the automatic start skipped, and the batches each would send. */
const backfillOptions = ref<Array<{ sessionId: string, title: string, batches: number }>>([])

async function loadBackfillOptions() {
  const document = memoryDocument.value
  const id = characterId.value
  if (!document) {
    backfillOptions.value = []
    return
  }
  const options: typeof backfillOptions.value = []
  for (const meta of Object.values(chatSession.sessionMetas)) {
    if (meta.characterId !== id || document.backfilledSessionIds.includes(meta.sessionId))
      continue
    const record = await chatSessionsRepo.getSession(meta.sessionId)
    const batches = record ? backfillBatchCount(document, meta.sessionId, record.messages) : 0
    if (batches)
      options.push({ sessionId: meta.sessionId, title: meta.title || formatDay(meta.createdAt), batches })
  }
  if (id === characterId.value)
    backfillOptions.value = options
}

function exportMemory() {
  const document = memoryDocument.value
  if (!document)
    return
  // The export holds only valid memory. Deletion marks, vectors, chats, and credentials stay out.
  const data = {
    format: 'airi-character-memory:v1',
    character: cards.value.get(characterId.value)?.name ?? characterId.value,
    coreBlocks: Object.fromEntries(coreBlocks.value.map(block => [block.key, block.text])),
    episodes: validEpisodes(document).map(({ text, occurredAt, createdAt, factKey }) => ({ text, factKey, date: new Date(occurredAt ?? createdAt).toISOString() })),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = Object.assign(window.document.createElement('a'), { href: url, download: `memory-${data.character}.json` })
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <SettingsCard>
    <FieldCheckbox
      v-model="enabledModel"
      :label="t('settings.pages.modules.memory-long-term.enable')"
      :description="t('settings.pages.modules.memory-long-term.enable-description')"
    />

    <template v-if="enabled">
      <FieldSelect
        v-if="characterOptions.length > 1"
        v-model="characterId"
        :label="t('settings.pages.modules.memory-long-term.character')"
        :options="characterOptions"
      />

      <div :class="['flex flex-wrap items-center gap-2']">
        <p :class="['flex-1 text-sm', status.state === 'idle' ? 'text-neutral-500 dark:text-neutral-400' : 'text-amber-700 dark:text-amber-300']">
          {{ statusText }}
        </p>
        <Button
          v-if="status.state === 'attention' && status.reason === 'consent'"
          size="sm"
          color="primary"
          variant="primary"
          :label="t('settings.pages.modules.memory-long-term.consent-action')"
          @click="memory.confirmExtractionProvider(characterId, extractionOverride.provider)"
        />
        <Button
          v-else-if="status.state === 'attention'"
          size="sm"
          :label="t('settings.pages.modules.memory-long-term.retry')"
          @click="memory.extractNow(characterId)"
        />
      </div>

      <section :class="['flex flex-col gap-3']">
        <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
          {{ t('settings.pages.modules.memory-long-term.remembered.title') }}
        </h3>
        <p v-if="!hasMemory" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.memory-long-term.remembered.empty') }}
        </p>
        <template v-for="block in coreBlocks" :key="block.key">
          <div v-if="block.text" :class="['flex items-start gap-2', 'rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900']">
            <div :class="['min-w-0 flex-1']">
              <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
                {{ t(`settings.pages.modules.memory-long-term.remembered.${block.key}`) }}
              </p>
              <p :class="['whitespace-pre-wrap text-sm', 'text-neutral-700 dark:text-neutral-200']">
                {{ block.text }}
              </p>
            </div>
            <Button size="sm" :label="t('settings.pages.modules.memory-long-term.remembered.clear-block')" @click="clearBlock(block.key)" />
          </div>
        </template>
        <ul v-if="episodes.length" :class="['flex flex-col gap-1']">
          <li
            v-for="episode in episodes"
            :key="episode.id"
            :class="['flex items-center gap-2', 'rounded-lg px-3 py-2', 'hover:bg-neutral-100 dark:hover:bg-neutral-900']"
          >
            <span :class="['shrink-0 text-xs tabular-nums', 'text-neutral-500 dark:text-neutral-400']">
              {{ formatDay(episode.occurredAt ?? episode.createdAt) }}
            </span>
            <span :class="['min-w-0 flex-1 text-sm', 'text-neutral-700 dark:text-neutral-200']">
              {{ episode.text }}
            </span>
            <IconButton
              icon="i-solar:trash-bin-minimalistic-bold-duotone"
              :aria-label="t('settings.pages.modules.memory-long-term.remembered.delete')"
              :title="t('settings.pages.modules.memory-long-term.remembered.delete')"
              @click="memory.deleteEpisode(characterId, episode.id)"
            />
          </li>
        </ul>
        <DoubleCheckButton v-if="hasMemory" size="sm" @confirm="memory.clear(characterId)">
          {{ t('settings.pages.modules.memory-long-term.clear-all') }}
          <template #confirm>
            {{ t('settings.pages.modules.memory-long-term.clear-all-confirm') }}
          </template>
          <template #cancel>
            {{ t('settings.pages.modules.memory-long-term.clear-all-cancel') }}
          </template>
        </DoubleCheckButton>
      </section>

      <Collapsible :label="t('settings.pages.modules.memory-long-term.advanced')">
        <div :class="['flex flex-col gap-6', 'pt-3']">
          <section :class="['flex flex-col gap-3']">
            <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.pages.modules.memory-long-term.extraction.title') }}
            </h3>
            <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.memory-long-term.extraction.description') }}
            </p>
            <FieldInput v-model="extractionModel" :label="t('settings.pages.modules.memory-long-term.extraction.model')" />
          </section>

          <section :class="['flex flex-col gap-3']">
            <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.pages.modules.memory-long-term.embedding.title') }}
            </h3>
            <FieldSelect
              v-model="embeddingModeModel"
              :label="t('settings.pages.modules.memory-long-term.embedding.mode')"
              :options="embeddingModeOptions"
            />
            <FieldInput v-if="embeddingMode === 'custom'" v-model="embeddingModel" :label="t('settings.pages.modules.memory-long-term.embedding.model')" />
            <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ currentSearch }}
            </p>
          </section>

          <section :class="['flex flex-col gap-3']">
            <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.pages.modules.memory-long-term.core-edit.title') }}
            </h3>
            <div v-for="block in coreBlocks" :key="block.key" :class="['flex flex-col gap-2']">
              <FieldInput
                v-model="coreDrafts[block.key]"
                :label="t(`settings.pages.modules.memory-long-term.remembered.${block.key}`)"
                :single-line="false"
              />
              <div :class="['flex flex-wrap items-center justify-between gap-2']">
                <FieldCheckbox
                  :model-value="block.locked"
                  :label="t('settings.pages.modules.memory-long-term.core-edit.lock')"
                  @update:model-value="locked => memory.setCoreBlockLock(characterId, block.key, !!locked)"
                />
                <Button
                  size="sm"
                  :label="t('settings.pages.modules.memory-long-term.core-edit.save')"
                  :disabled="coreDrafts[block.key] === block.text"
                  @click="memory.editCoreBlock(characterId, block.key, coreDrafts[block.key])"
                />
              </div>
            </div>
          </section>

          <section :class="['flex flex-col gap-2']">
            <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.pages.modules.memory-long-term.invalidated.title') }}
            </h3>
            <p v-if="!replacedEpisodes.length" :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.memory-long-term.invalidated.empty') }}
            </p>
            <ul v-else :class="['flex flex-col gap-1']">
              <li v-for="episode in replacedEpisodes" :key="episode.id" :class="['text-sm line-through', 'text-neutral-500 dark:text-neutral-400']">
                {{ formatDay(episode.occurredAt ?? episode.createdAt) }} {{ episode.text }}
              </li>
            </ul>
          </section>

          <section :class="['flex flex-col gap-2']">
            <h3 :class="['text-sm font-medium', 'text-neutral-800 dark:text-neutral-100']">
              {{ t('settings.pages.modules.memory-long-term.backfill.title') }}
            </h3>
            <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.memory-long-term.backfill.description') }}
            </p>
            <p v-if="!backfillOptions.length" :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.memory-long-term.backfill.none') }}
            </p>
            <div v-for="option in backfillOptions" :key="option.sessionId" :class="['flex items-center justify-between gap-2']">
              <span :class="['min-w-0 truncate text-sm', 'text-neutral-700 dark:text-neutral-200']">{{ option.title }}</span>
              <DoubleCheckButton size="sm" color="primary" @confirm="memory.backfillSession(characterId, option.sessionId)">
                {{ t('settings.pages.modules.memory-long-term.backfill.action', { count: option.batches }) }}
              </DoubleCheckButton>
            </div>
          </section>

          <div>
            <Button size="sm" :label="t('settings.pages.modules.memory-long-term.export')" :disabled="!hasMemory" @click="exportMemory" />
          </div>
        </div>
      </Collapsible>
    </template>
  </SettingsCard>
</template>
