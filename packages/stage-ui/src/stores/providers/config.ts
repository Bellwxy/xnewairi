import type {} from 'pinia-plugin-synced'

import type { InferenceServiceProvider, ProviderValidationStatus } from '../../libs/providers/types'

import { brand } from '@proj-airi/stage-shared/brand'
import { useAccountLocalStorage } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { getDefinedProvider } from '../../libs/providers'

const providerStorageOptions = {
  // pinia-plugin-synced is the only cross-window propagation channel for this
  // store. Listening to storage events would feed replicated state back into
  // the leader as a new state proposal.
  listenToStorageChanges: false,
} as const

/**
 * The only provider definition that serves LLM requests. Chat, vision, memory, and embedding all use it.
 * The provider store rejects LLM requests to any other definition, and the settings route opens only this one.
 */
export const gatewayProviderDefinitionId = 'openai-compatible'

/**
 * Pins the customer gateway into a chat endpoint configuration.
 *
 * Chat, vision, and memory read `baseUrl` from the stored configuration, so the store pins it on every write.
 * A build without `inferenceBaseUrl` keeps the endpoint that the user entered in onboarding.
 */
function withGatewayEndpoint(definitionId: string, config: Record<string, unknown>) {
  if (!brand.inferenceBaseUrl || definitionId !== gatewayProviderDefinitionId)
    return config
  return { ...config, baseUrl: brand.inferenceBaseUrl }
}

/**
 * Provider configurations of the account. They stay on this device. The first release does not sync them to the cloud.
 */
export const useProviderConfigStore = defineStore('provider-config', () => {
  const providers = useAccountLocalStorage<Record<string, InferenceServiceProvider>>('settings/providers/configured', {}, providerStorageOptions)
  const addedProviders = useAccountLocalStorage<Record<string, boolean>>('settings/providers/added', {}, providerStorageOptions)
  const legacyConfigs = useAccountLocalStorage<Record<string, Record<string, unknown>>>('settings/credentials/providers', {}, providerStorageOptions)

  // Import the previous provider configuration shape once. Provider ids remain
  // stable, so existing model selections keep pointing at the same provider.
  for (const [providerId, config] of Object.entries(legacyConfigs.value)) {
    if (providers.value[providerId])
      continue

    const definitionId = providerId.startsWith('vision-')
      ? providerId.slice('vision-'.length)
      : providerId
    const definition = getDefinedProvider(definitionId)
    if (!definition)
      continue

    providers.value[providerId] = {
      id: providerId,
      definitionId,
      config,
      status: 'unconfigured',
      configuredBy: definition.configuredBy ?? 'user',
    }
  }

  // Provider definitions own configuration lifecycle policy. Apply that
  // policy to persisted snapshots before module pages consume them. Providers
  // without an owner declaration remain user-configured.
  for (const provider of Object.values(providers.value)) {
    const configuredByDefinition = getDefinedProvider(provider.definitionId)?.configuredBy
    if (configuredByDefinition) {
      provider.configuredBy = configuredByDefinition
    }
    else if (!provider.configuredBy) {
      provider.configuredBy = 'user'
    }
    provider.config = withGatewayEndpoint(provider.definitionId, provider.config)
  }

  const configs = computed(() => Object.fromEntries(
    Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.config]),
  ))
  const listedProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).filter(([providerId]) => addedProviders.value[providerId]),
  ))
  const configuredProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.status === 'configured']),
  ))

  function getProvider(providerId: string) {
    return providers.value[providerId]
  }

  function getProviderConfig(providerId: string) {
    return providers.value[providerId]?.config
  }

  function ensureProvider(providerId: string, definitionId: string, config: Record<string, unknown> = {}) {
    const current = providers.value[providerId]
    if (current)
      return current

    const definition = getDefinedProvider(definitionId)
    if (!definition)
      throw new Error(`Provider definition with id "${definitionId}" not found.`)

    const provider: InferenceServiceProvider = {
      id: providerId,
      definitionId,
      config: withGatewayEndpoint(definitionId, config),
      status: 'unconfigured',
      configuredBy: definition.configuredBy ?? 'user',
    }
    providers.value[providerId] = provider
    return provider
  }

  function markProviderAdded(providerId: string) {
    addedProviders.value[providerId] = true
  }

  function unmarkProviderAdded(providerId: string) {
    delete addedProviders.value[providerId]
  }

  function setProviderStatus(providerId: string, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    provider.status = status
  }

  /**
   * Applies configuration fields through the leader-owned provider snapshot.
   *
   * The caller must initialize the provider before this action runs. The leader
   * merges the patch with its current configuration to keep unrelated changes.
   * Returns false if the provider no longer exists.
   */
  async function patchProviderConfig(providerId: string, patch: Record<string, unknown>) {
    const provider = providers.value[providerId]
    if (!provider)
      return false

    providers.value[providerId] = {
      ...provider,
      config: withGatewayEndpoint(provider.definitionId, { ...provider.config, ...patch }),
    }
    return true
  }

  /**
   * Updates the selected model in the leader-owned provider snapshot.
   *
   * Follower renderers must await this action instead of mutating replicated
   * configuration directly, because `state: true` proposals contain the full
   * store and can overwrite newer leader state.
   */
  async function setProviderModel(providerId: string, model: string) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    providers.value[providerId] = {
      ...provider,
      config: { ...provider.config, model },
    }
  }

  /**
   * Seeds a discovered default without replacing a model selected by the user.
   */
  async function setProviderModelIfUnset(providerId: string, model: string) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    const currentModel = provider.config.model
    if (typeof currentModel === 'string' && currentModel.length > 0)
      return

    providers.value[providerId] = {
      ...provider,
      config: { ...provider.config, model },
    }
  }

  async function addProvider(definitionId: string, initialConfig: Record<string, unknown> = {}) {
    const provider = ensureProvider(nanoid(), definitionId, initialConfig)
    markProviderAdded(provider.id)
    return provider
  }

  async function removeProvider(providerId: string) {
    if (!providers.value[providerId])
      return

    delete providers.value[providerId]
    unmarkProviderAdded(providerId)
  }

  async function updateProviderConfig(providerId: string, config: Record<string, unknown>, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    const next: InferenceServiceProvider = {
      ...provider,
      config: withGatewayEndpoint(provider.definitionId, { ...config }),
      status,
    }
    providers.value[providerId] = next
    return next
  }

  async function resetProviders() {
    providers.value = {}
    addedProviders.value = {}
  }

  return {
    providers,
    configs,
    addedProviders,
    listedProviders,
    configuredProviders,

    getProvider,
    getProviderConfig,
    ensureProvider,
    markProviderAdded,
    unmarkProviderAdded,
    setProviderStatus,
    patchProviderConfig,
    setProviderModel,
    setProviderModelIfUnset,
    addProvider,
    removeProvider,
    updateProviderConfig,
    resetProviders,
  }
}, {
  synced: {
    actions: [
      'ensureProvider',
      'markProviderAdded',
      'unmarkProviderAdded',
      'setProviderStatus',
      'patchProviderConfig',
      'setProviderModel',
      'setProviderModelIfUnset',
      'addProvider',
      'removeProvider',
      'updateProviderConfig',
      'resetProviders',
    ],
    state: true,
  },
})
