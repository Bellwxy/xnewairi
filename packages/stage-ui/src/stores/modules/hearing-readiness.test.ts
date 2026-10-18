import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHearingStore } from './hearing'

const { bundledRecognizers } = vi.hoisted(() => ({
  // The vite plugin decides at build time which recognizers the package contains.
  bundledRecognizers: [] as { id: string }[],
}))

vi.mock('../../libs/providers/providers/sherpaw/model-resources', () => ({
  get availableSherpawModels() {
    return bundledRecognizers
  },
  sherpawModelResources: [],
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en' }, t: (key: string) => key }),
}))

describe('hearing readiness', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    bundledRecognizers.splice(0)
  })

  it('reports the bundled recognizer as ready without a Hearing model', () => {
    bundledRecognizers.push({ id: 'x-asr-zh-en-480ms-int8' })
    const hearing = useHearingStore()

    hearing.activeTranscriptionProvider = 'sherpaw-transcription'
    hearing.activeTranscriptionModel = ''

    expect(hearing.configured).toBe(true)
  })

  it('reports the bundled recognizer as not ready when the package contains none', () => {
    const hearing = useHearingStore()

    hearing.activeTranscriptionProvider = 'sherpaw-transcription'
    hearing.activeTranscriptionModel = ''

    expect(hearing.configured).toBe(false)
  })
})
