import type { AudioInputSession } from '../../../src/types'

import { pageAccountScope } from '../../../src/setup/account-scope'

/** Provider values stored by one case preflight callback. */
export interface ProviderConfiguration {
  config: Record<string, unknown>
  definitionId: string
  id: string
  model: string
}

/** Adds one Provider without replacing Providers configured by earlier callbacks. */
export async function configureProvider(runtime: AudioInputSession, provider: ProviderConfiguration): Promise<void> {
  const scope = await pageAccountScope(runtime.page)
  const keys = {
    credentials: scope.storageKey('settings/credentials/providers'),
    configured: scope.storageKey('settings/providers/configured'),
    added: scope.storageKey('settings/providers/added'),
  }
  await runtime.page.evaluate(({ configuredProvider, keys }) => {
    const credentials = JSON.parse(localStorage.getItem(keys.credentials) ?? '{}') as Record<string, unknown>
    const configured = JSON.parse(localStorage.getItem(keys.configured) ?? '{}') as Record<string, unknown>
    const added = JSON.parse(localStorage.getItem(keys.added) ?? '{}') as Record<string, boolean>

    credentials[configuredProvider.id] = configuredProvider.config
    configured[configuredProvider.id] = {
      id: configuredProvider.id,
      definitionId: configuredProvider.definitionId,
      config: configuredProvider.config,
      status: 'configured',
    }
    added[configuredProvider.id] = true

    localStorage.setItem(keys.credentials, JSON.stringify(credentials))
    localStorage.setItem(keys.configured, JSON.stringify(configured))
    localStorage.setItem(keys.added, JSON.stringify(added))
  }, { configuredProvider: provider, keys })
}
