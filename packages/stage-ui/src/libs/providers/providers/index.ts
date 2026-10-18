import type { ProviderDefinition } from '../types'

import { createOpenAICompatibleValidators, portableProviderDefinitions, ProviderValidationCheck } from '@proj-airi/provider-inference'
import { brand } from '@proj-airi/stage-shared/brand'

import { registerProviders } from './registry'

import './aliyun-nls'
import './apple-speech'
import './apple-vision'
import './sherpaw'
import './local-audio'
import './kokoro-local'
import './local-speech'
import './nvidia'
import './prompt-api'

/**
 * Validates the gateway with the model that the brand fixes.
 *
 * The gateway is the `openai-compatible` definition. With a fixed model, the key check sends one chat request and no model catalog request.
 */
function withBrandGatewayValidation(definition: ProviderDefinition): ProviderDefinition {
  if (definition.id !== 'openai-compatible' || !brand.inferenceModel)
    return definition

  return {
    ...definition,
    validators: createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.ChatCompletions],
      validationModel: brand.inferenceModel,
    }),
  }
}

registerProviders(portableProviderDefinitions.map(withBrandGatewayValidation))

export {
  getDefinedProvider,
  isProviderId,
  listProviders,
} from './registry'

export type { StageProviderId } from './registry'
