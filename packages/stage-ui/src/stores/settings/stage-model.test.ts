import type { DisplayModelURL } from '../display-models'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'
import { useSettingsStageModel } from './stage-model'

const { initialStageModelId, resetLegacyModelIdentity } = vi.hoisted(() => ({
  initialStageModelId: { value: 'preset-live2d-1' },
  resetLegacyModelIdentity: vi.fn(),
}))

vi.mock('@proj-airi/stage-ui-three', () => ({
  useModelStore: () => ({ resetLegacyModelIdentity }),
}))

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const { refManualReset } = await import('@vueuse/core')

  return {
    useLocalStorageManualReset: (key: string, value: string) => refManualReset(
      key === 'settings/stage/model' ? initialStageModelId.value : value,
    ),
  }
})

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()

  return {
    ...actual,
    useEventListener: vi.fn(),
  }
})

describe('settings stage model store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    initialStageModelId.value = 'preset-live2d-1'
    resetLegacyModelIdentity.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // https://github.com/moeru-ai/airi/issues/1984
  it('issue #1984: falls back to the default preset when a custom stage model is missing', async () => {
    const fallbackModel: DisplayModelURL = {
      id: 'preset-live2d-1',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/preset-live2d.zip',
      name: 'Preset Live2D',
      importedAt: 1,
    }

    const displayModelsStore = useDisplayModelsStore()
    const getDisplayModelSpy = vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === 'display-model-missing')
        return undefined
      if (id === fallbackModel.id)
        return fallbackModel
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = 'display-model-missing'

    await store.initializeStageModel()

    expect(store.stageModelSelected).toBe(fallbackModel.id)
    expect(store.stageModelSelectedDisplayModel).toEqual(fallbackModel)
    expect(store.stageModelSelectedUrl).toBe(fallbackModel.url)
    expect(store.stageModelRenderer).toBe('live2d')
    expect(getDisplayModelSpy).toHaveBeenCalledWith('display-model-missing')
    expect(getDisplayModelSpy).toHaveBeenCalledWith(fallbackModel.id)
    expect(resetLegacyModelIdentity).not.toHaveBeenCalled()
  })

  it.each([
    { format: DisplayModelFormat.VRM, url: 'https://example.com/character.vrm' },
    { format: DisplayModelFormat.TachieZip, url: 'https://example.com/character.tachie.zip' },
    { format: DisplayModelFormat.PMXZip, url: 'https://example.com/character.zip' },
  ])('activates the default Live2D preset in place of an earlier $format import', async ({ format, url }) => {
    // The product renders Live2D only. Earlier versions could import other formats, and their ids stay selected.
    const defaultModel: DisplayModelURL = {
      id: 'preset-live2d-1',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/preset-live2d.zip',
      name: 'Preset Live2D',
      importedAt: 1,
    }
    const earlierImport: DisplayModelURL = { id: 'display-model-earlier', format, type: 'url', url, name: 'Earlier import', importedAt: 2 }
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async id => id === earlierImport.id ? earlierImport : defaultModel)
    initialStageModelId.value = earlierImport.id
    const store = useSettingsStageModel()

    await store.initializeStageModel()

    expect(store.stageModelSelected).toBe(defaultModel.id)
    expect(store.stageModelSelectedDisplayModel).toEqual(defaultModel)
    expect(store.stageModelSelectedUrl).toBe(defaultModel.url)
    expect(store.stageModelRenderer).toBe('live2d')
  })

  it('resets the legacy model identity before publishing the startup model', async () => {
    const live2dModel: DisplayModelURL = {
      id: 'display-model-live2d',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/character.zip',
      name: 'Live2D character',
      importedAt: 1,
    }
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockResolvedValue(live2dModel)

    vi.stubGlobal('window', {})
    initialStageModelId.value = live2dModel.id
    const store = useSettingsStageModel()

    resetLegacyModelIdentity.mockImplementationOnce(() => {
      expect(store.stageModelRenderer).toBeUndefined()
      expect(store.stageModelSelectedUrl).toBeUndefined()
    })

    await store.initializeStageModel()

    expect(resetLegacyModelIdentity).toHaveBeenCalledWith()
    expect(store.stageModelRenderer).toBe('live2d')
    expect(store.stageModelSelectedUrl).toBe(live2dModel.url)
  })
})
