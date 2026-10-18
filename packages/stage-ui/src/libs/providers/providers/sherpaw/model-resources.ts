import type { SherpawModelResource } from '@proj-airi/provider-inference'

import { sherpawModels } from '@proj-airi/provider-inference'
import { assets } from '@proj-airi/vite-plugin-sherpaw/assets'

/**
 * Models that the host package contains. Desktop bundles X-ASR, and Android bundles Paraformer.
 * Remote models stay out, because the product does not download recognizers at runtime.
 */
export const sherpawModelResources: SherpawModelResource[] = Object.values(sherpawModels).flatMap((model) => {
  const files = assets[model.id]
  return files?.source === 'bundled' ? [{ model, files }] : []
})

export const availableSherpawModels = sherpawModelResources.map(({ model }) => model)
