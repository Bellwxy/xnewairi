import type { Card } from '@proj-airi/ccc'

import type { AiriCard, AiriExtension } from '../types/airiCard'

import { describe, expect, it } from 'vitest'

import { applyAiriCardEditorModules, getAiriCardEditorModuleSettings, isPersonalityOverLimit, mergeCardEdit, safeParseAiriCardDraft } from './airi-card-editor'

describe('airi card editor validation', () => {
  // https://github.com/moeru-ai/airi/issues/2108
  it('preserves display text and accepts optional empty fields for Issue #2108', () => {
    // ROOT CAUSE:
    //
    // The creation dialog normalized every input event and treated optional
    // CCv3 text fields as required. Multi-word names were rewritten while
    // otherwise valid minimal cards could not be saved.
    //
    // We fixed this by preserving draft input and normalizing only required
    // boundary fields through the shared Valibot schema.
    const result = safeParseAiriCardDraft({
      ...createCard(),
      name: '  ReLU Chan  ',
      description: '',
      personality: '',
      scenario: '',
      systemPrompt: '',
      postHistoryInstructions: '',
    }, '{ "steps": 12 }')

    expect(result.success).toBe(true)
    if (!result.success)
      return

    expect(result.output.card.name).toBe('ReLU Chan')
    expect(result.output.card.description).toBe('')
    expect(result.output.card.personality).toBe('')
    expect(result.output.card.scenario).toBe('')
    expect(result.output.card.systemPrompt).toBe('')
    expect(result.output.card.postHistoryInstructions).toBe('')
    expect(result.output.artistryOptions).toEqual({ steps: 12 })
  })

  // https://github.com/moeru-ai/airi/issues/2108
  it('rejects invalid required fields and Artistry JSON for Issue #2108', () => {
    expect(safeParseAiriCardDraft({ ...createCard(), name: '   ' }, '{}')).toEqual({
      success: false,
      error: 'name',
    })
    expect(safeParseAiriCardDraft({ ...createCard(), version: 'v1' }, '{}')).toEqual({
      success: false,
      error: 'version',
    })
    expect(safeParseAiriCardDraft(createCard(), '[]')).toEqual({
      success: false,
      error: 'invalid_artistry_json',
    })
    expect(safeParseAiriCardDraft(createCard(), '{')).toEqual({
      success: false,
      error: 'invalid_artistry_json',
    })
  })

  it('treats blank Artistry options as absent', () => {
    const result = safeParseAiriCardDraft(createCard(), '   ')

    expect(result.success).toBe(true)
    if (!result.success)
      return

    expect(result.output.artistryOptions).toBeUndefined()
  })

  it('keeps empty uploaded-card module fields inherited when saved', () => {
    // ROOT CAUSE:
    //
    // The editor replaced empty uploaded-card fields with the current global
    // settings during initialization. Saving an unrelated change then stored
    // these values as card overrides.
    //
    // We fixed this by keeping empty module fields in the editor state. The
    // saved card keeps these fields empty, so they inherit global settings.
    const uploadedCard: Card = {
      ...createCard(),
      description: 'Imported card',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '' },
            displayModelId: '',
          },
          agents: {},
        },
      },
    }

    const moduleSettings = getAiriCardEditorModuleSettings(uploadedCard)
    const savedCard = applyAiriCardEditorModules({
      ...uploadedCard,
      description: 'Edited imported card',
    }, {
      ...moduleSettings,
      artistry: {
        provider: '',
        model: '',
        promptPrefix: '',
        widgetInstruction: '',
        spawnMode: 'bg_widget',
        options: undefined,
        autonomousEnabled: false,
        autonomousThreshold: 70,
      },
    })

    expect(savedCard.description).toBe('Edited imported card')
    expect(savedCard.extensions.airi.modules.consciousness).toEqual({ provider: '', model: '' })
    expect(savedCard.extensions.airi.modules.speech).toMatchObject({ provider: '', model: '', voice_id: '' })
    expect(savedCard.extensions.airi.modules.displayModelId).toBe('')
  })

  it('preserves AIRI extension fields that are not editable in the form', () => {
    // ROOT CAUSE:
    //
    // Saving the editor rebuilt `extensions.airi.modules` from visible form
    // controls and reset `agents` to an empty object. Hidden settings such as
    // body models, backgrounds, advanced speech/artistry fields, and agent
    // prompts were therefore lost after an otherwise unrelated edit.
    //
    // We fix this by applying the editor-owned fields as a structured patch
    // over the existing extension.
    const existing: AiriExtension = {
      modules: {
        consciousness: { provider: 'old-chat', model: 'old-chat-model' },
        speech: {
          provider: 'old-speech',
          model: 'old-speech-model',
          voice_id: 'old-voice',
          pitch: 1.2,
          rate: 0.9,
          ssml: true,
          language: 'ja',
        },
        vrm: { source: 'url', url: 'https://example.com/avatar.vrm' },
        live2d: { source: 'file', file: 'models/avatar.model3.json' },
        displayModelId: 'old-display-model',
        activeBackgroundId: 'background-1',
        artistry: {
          enabled: true,
          provider: 'old-artistry',
          model: 'old-artistry-model',
          workflowId: 'workflow-1',
          autonomousTarget: 'user',
        },
      },
      agents: {
        minecraft: { prompt: 'Keep building.', enabled: true },
      },
    }

    const result = applyAiriCardEditorModules({
      ...createCard(),
      extensions: {
        thirdParty: { keep: true },
        airi: {
          ...existing,
          futureRootField: { keep: true },
        },
      },
    }, {
      consciousness: { provider: 'new-chat', model: 'new-chat-model' },
      speech: { provider: 'new-speech', model: 'new-speech-model', voice_id: 'new-voice' },
      displayModelId: 'new-display-model',
      artistry: {
        provider: 'new-artistry',
        model: 'new-artistry-model',
        promptPrefix: 'portrait',
        widgetInstruction: 'Use the image widget.',
        spawnMode: 'widget',
        options: { steps: 12 },
        autonomousEnabled: true,
        autonomousThreshold: 80,
      },
    })

    const extension = result.extensions.airi

    expect(result.extensions.thirdParty).toEqual({ keep: true })
    expect(extension).toHaveProperty('futureRootField', { keep: true })
    expect(extension.modules.consciousness).toEqual({ provider: 'new-chat', model: 'new-chat-model' })
    expect(extension.modules.speech).toEqual({
      provider: 'new-speech',
      model: 'new-speech-model',
      voice_id: 'new-voice',
      pitch: 1.2,
      rate: 0.9,
      ssml: true,
      language: 'ja',
    })
    expect(extension.modules.vrm).toEqual(existing.modules.vrm)
    expect(extension.modules.live2d).toEqual(existing.modules.live2d)
    expect(extension.modules.displayModelId).toBe('new-display-model')
    expect(extension.modules.activeBackgroundId).toBe('background-1')
    expect(extension.modules.artistry).toEqual({
      enabled: true,
      provider: 'new-artistry',
      model: 'new-artistry-model',
      promptPrefix: 'portrait',
      workflowId: 'workflow-1',
      widgetInstruction: 'Use the image widget.',
      spawnMode: 'widget',
      options: { steps: 12 },
      autonomousEnabled: true,
      autonomousThreshold: 80,
      autonomousTarget: 'user',
    })
    expect(extension.agents).toEqual(existing.agents)
  })
})

describe('isPersonalityOverLimit', () => {
  it('blocks a new personality over 2000 code points', () => {
    expect(isPersonalityOverLimit('😀'.repeat(2001), 'short')).toBe(true)
    expect(isPersonalityOverLimit('😀'.repeat(2000), 'short')).toBe(false)
  })

  it('keeps an unchanged imported personality over the limit', () => {
    const imported = 'a'.repeat(3000)

    expect(isPersonalityOverLimit(imported, imported)).toBe(false)
  })
})

describe('mergeCardEdit', () => {
  it('keeps a wake word that a tool wrote while the editor was open', () => {
    const baseline = createAiriCard({ personality: 'Calm.' })
    const draft = createAiriCard({ personality: 'Cheerful.' })
    const latest = createAiriCard({ personality: 'Calm.', wakeWords: [{ text: 'mio', modelId: 'zh-kws', pronunciations: [['m', 'i', 'o']] }] })

    const result = mergeCardEdit({ baseline, draft, latest })

    expect(result.conflicts).toEqual([])
    expect(result.card.personality).toBe('Cheerful.')
    const airi = result.card.extensions?.airi as AiriExtension | undefined
    expect(airi?.wakeWords).toEqual([{ text: 'mio', modelId: 'zh-kws', pronunciations: [['m', 'i', 'o']] }])
  })

  it('keeps the latest value of a field that the draft did not change', () => {
    const baseline = createAiriCard({ personality: 'Calm.', scenario: 'A cafe.' })
    const draft = createAiriCard({ personality: 'Cheerful.', scenario: 'A cafe.' })
    const latest = createAiriCard({ personality: 'Calm.', scenario: 'A library.' })

    expect(mergeCardEdit({ baseline, draft, latest }).card.scenario).toBe('A library.')
  })

  it('reports a field that both sides changed to different values', () => {
    const baseline = createAiriCard({ personality: 'Calm.' })
    const draft = createAiriCard({ personality: 'Cheerful.' })
    const latest = createAiriCard({ personality: 'Shy.' })

    const mine = mergeCardEdit({ baseline, draft, latest }, 'draft')
    const theirs = mergeCardEdit({ baseline, draft, latest }, 'latest')

    expect(mine.conflicts).toEqual(['/personality'])
    expect(mine.card.personality).toBe('Cheerful.')
    expect(theirs.conflicts).toEqual(['/personality'])
    expect(theirs.card.personality).toBe('Shy.')
  })

  it('does not report a field that both sides changed to the same value', () => {
    const baseline = createAiriCard({ personality: 'Calm.' })
    const draft = createAiriCard({ personality: 'Cheerful.' })
    const latest = createAiriCard({ personality: 'Cheerful.' })

    expect(mergeCardEdit({ baseline, draft, latest }).conflicts).toEqual([])
  })
})

function createAiriCard(fields: Partial<Card> & { wakeWords?: AiriExtension['wakeWords'] }): AiriCard {
  const { wakeWords, ...cardFields } = fields
  return {
    ...createCard(),
    ...cardFields,
    extensions: {
      airi: {
        ...(wakeWords ? { wakeWords } : {}),
        modules: {
          consciousness: { provider: '', model: '' },
          speech: { provider: '', model: '', voice_id: '' },
        },
        agents: {},
      },
    },
  }
}

function createCard(): Card {
  return {
    name: 'ReLU',
    version: '1.0',
    greetings: [],
    messageExample: [],
  }
}
