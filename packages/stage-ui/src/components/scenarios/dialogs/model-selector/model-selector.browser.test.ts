import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import { DisplayModelFormat, useDisplayModelsStore } from '../../../../stores/display-models'

import 'virtual:uno.css'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
})

afterEach(() => {
  disposePinia(pinia)
})

it('offers only Live2D models when earlier imports include other formats', async () => {
  // An earlier version imported VRM and MMD models. They stay stored after the product dropped those renderers.
  useDisplayModelsStore(pinia).displayModels = [
    { id: 'display-model-live2d', format: DisplayModelFormat.Live2dZip, type: 'url', url: 'https://example.com/live2d.zip', name: 'Imported Live2D', importedAt: 3 },
    { id: 'display-model-vrm', format: DisplayModelFormat.VRM, type: 'url', url: 'https://example.com/model.vrm', name: 'Imported VRM', importedAt: 2 },
    { id: 'display-model-mmd', format: DisplayModelFormat.PMXZip, type: 'url', url: 'https://example.com/model.zip', name: 'Imported MMD', importedAt: 1 },
  ]

  // The app loads the Cubism runtime script before the Live2D package. The selector only needs the package to import.
  Object.assign(window, { Live2DCubismCore: {} })
  const { default: ModelSelector } = await import('./model-selector.vue')
  render(ModelSelector, {
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })

  await expect.element(page.getByText('Imported Live2D')).toBeInTheDocument()
  await expect.element(page.getByText('Imported VRM')).not.toBeInTheDocument()
  await expect.element(page.getByText('Imported MMD')).not.toBeInTheDocument()
})
