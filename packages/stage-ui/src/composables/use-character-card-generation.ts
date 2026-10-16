import type { CharacterBrief, GeneratedCharacterFields } from '../services/character-card-generation'

import { generateCharacterFields } from '../services/character-card-generation'
import { useLLM } from '../stores/ai/chat-llm/llm'
import { useProviderStore } from '../stores/providers/provider'

/** The chat model that writes the card. Onboarding passes the selected model. Regeneration passes the model of the card. */
export interface CharacterGenerationModel {
  provider: string
  model: string
}

/**
 * Generates character card text with a chat model.
 *
 * Returns:
 * - `generate`, which rejects when no model is given, the request fails, the reply is invalid, or the timeout ends.
 *   See {@link generateCharacterFields} for the reply contract.
 */
export function useCharacterCardGeneration() {
  const llm = useLLM()
  const providers = useProviderStore()

  async function generate(selection: CharacterGenerationModel, brief: CharacterBrief, signal?: AbortSignal): Promise<GeneratedCharacterFields> {
    if (!selection.provider || !selection.model)
      throw new Error('No chat model is configured for character generation')

    const provider = await providers.getChatProviderInstance(selection.provider)
    return generateCharacterFields(brief, async (conversation, requestSignal) => {
      let reply = ''
      await llm.stream(selection.model, provider, conversation, {
        // Generation calls no tools. A provider without tool calling rejects a tool list.
        supportsTools: false,
        abortSignal: requestSignal,
        onStreamEvent: (event) => {
          if (event.type === 'text-delta')
            reply += event.text
        },
      })
      return reply
    }, { signal })
  }

  return { generate }
}
