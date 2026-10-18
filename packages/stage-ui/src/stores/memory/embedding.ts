import type { EmbeddingDetection } from './memory-settings'

import { errorMessageFrom } from '@moeru/std'
import { embed, embedMany } from '@xsai/embed'

import { useLLM } from '../ai/chat-llm/llm'
import { gatewayProviderDefinitionId, useProviderConfigStore } from '../providers/config'
import { useMemorySettingsStore } from './memory-settings'

/**
 * Embedding models that automatic detection accepts, best first. All of them handle Chinese well.
 * `nomic-embed-text` is absent on purpose: it is an English model.
 */
const recommendedEmbeddingModels = ['BAAI/bge-m3', 'text-embedding-v4', 'bge-m3']

/** The embedding endpoint and model of one character. `version` names the vector space. It holds no credentials. */
export interface EmbeddingTarget {
  baseURL: string
  apiKey: string
  model: string
  version: string
}

function readEndpoint(providerId: string) {
  const provider = useProviderConfigStore().getProvider(providerId)
  // Embedding is an LLM request, so only the gateway serves it. Another provider falls back to keyword recall.
  if (provider?.definitionId !== gatewayProviderDefinitionId)
    return undefined
  const config = provider.config
  const baseURL = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : ''
  const apiKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
  return baseURL ? { baseURL: baseURL.endsWith('/') ? baseURL : `${baseURL}/`, apiKey } : undefined
}

/**
 * Picks the first recommended model that the endpoint lists. Matching ignores case and accepts a vendor prefix.
 *
 * @example
 * pickEmbeddingModel(['gpt-4o', 'Pro/BAAI/bge-m3'])
 * // => 'Pro/BAAI/bge-m3'
 */
export function pickEmbeddingModel(modelIds: readonly string[]): string | undefined {
  for (const recommended of recommendedEmbeddingModels) {
    const wanted = recommended.toLowerCase()
    const match = modelIds.find(id => id.toLowerCase() === wanted || id.toLowerCase().endsWith(`/${wanted}`))
    if (match)
      return match
  }
  return undefined
}

/**
 * Resolves and detects the embedding model of memory.
 *
 * Every failure, including a cross-origin block in the Android WebView, gives no target.
 * Recall then uses keywords only, and nothing is reported as an error.
 */
export function useMemoryEmbedding() {
  const llm = useLLM()
  const settings = useMemorySettingsStore()

  async function detect(chatProvider: string, chatModel: string): Promise<EmbeddingTarget | undefined> {
    const endpoint = readEndpoint(chatProvider)
    if (!endpoint)
      return undefined

    const key = [chatProvider, endpoint.baseURL, chatModel].join('|')
    const cached = settings.embeddingDetection
    let model = cached?.key === key ? cached.model : undefined

    if (model === undefined) {
      try {
        const listed = await llm.models(endpoint.baseURL, endpoint.apiKey)
        model = pickEmbeddingModel(listed.map(entry => entry.id)) ?? ''
        // One short probe proves that the endpoint accepts the model before any memory depends on it.
        if (model)
          await embed({ ...endpoint, model, input: 'ping' })
      }
      catch (error) {
        console.info('[memory] No embedding model is available, so recall uses keywords only:', errorMessageFrom(error))
        model = ''
      }
      await settings.recordEmbeddingDetection({ key, model, checkedAt: Date.now() } satisfies EmbeddingDetection)
    }

    return model ? { ...endpoint, model, version: [chatProvider, endpoint.baseURL, model].join('|') } : undefined
  }

  /** Resolves the target for a character whose chat runs on `chatProvider` and `chatModel`. */
  async function resolveTarget(chatProvider: string, chatModel: string): Promise<EmbeddingTarget | undefined> {
    if (settings.embeddingMode === 'off')
      return undefined

    if (settings.embeddingMode === 'custom') {
      const { provider, model } = settings.embeddingOverride
      const endpoint = provider ? readEndpoint(provider) : undefined
      return endpoint && model ? { ...endpoint, model, version: [provider, endpoint.baseURL, model].join('|') } : undefined
    }

    return detect(chatProvider, chatModel)
  }

  async function embedTexts(target: EmbeddingTarget, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!texts.length)
      return []
    const result = await embedMany({ baseURL: target.baseURL, apiKey: target.apiKey, model: target.model, input: texts, abortSignal: signal })
    return result.embeddings
  }

  return { resolveTarget, embedTexts }
}
