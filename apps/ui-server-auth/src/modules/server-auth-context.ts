import { brand } from '@proj-airi/stage-shared/brand'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

export interface ServerAuthBootstrapContext {
  apiServerUrl: string
  currentUrl: string
  oidcCallback?: {
    code: string
    error: string
    errorDescription: string
    state: string
  }
}

const SCRIPT_ID = 'airi-server-auth-context'
const API_SERVER_URL_QUERY_PARAM = 'api_server_url'

// The customer build trusts only its configured API server and local development servers.
const trustedApiServerUrl = new URL(brand.serverUrl)

const TRUSTED_LOCAL_API_SERVER_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/localhost(:\d+)?$/,
  /^https:\/\/127\.0\.0\.1(:\d+)?$/,
]

let cachedContext: ServerAuthBootstrapContext | null | undefined

export function getServerAuthBootstrapContext(): ServerAuthBootstrapContext | null {
  if (cachedContext !== undefined)
    return cachedContext

  const element = document.getElementById(SCRIPT_ID)
  if (!element) {
    cachedContext = resolveStandaloneServerAuthContext(window.location.href, SERVER_URL)
    return cachedContext
  }

  try {
    const parsed = JSON.parse(element.textContent ?? '') as Partial<ServerAuthBootstrapContext>
    cachedContext = {
      apiServerUrl: parsed.apiServerUrl ?? SERVER_URL,
      currentUrl: parsed.currentUrl ?? window.location.href,
      oidcCallback: parsed.oidcCallback,
    }
    return cachedContext
  }
  catch {
    cachedContext = resolveStandaloneServerAuthContext(window.location.href, SERVER_URL)
    return cachedContext
  }
}

/**
 * Resolves API-server context carried by server redirects into static auth UI.
 *
 * Use when:
 * - The server-owned `/auth/*` redirect tells the static auth UI which API server to use.
 *
 * Expects:
 * - The server-owned `/auth/*` redirect sets `api_server_url`.
 * - Only the configured customer API origin and localhost development origins are accepted.
 *
 * Returns:
 * - A bootstrap context using the trusted API origin, or null when no trusted
 *   override is present.
 */
export function resolveStandaloneServerAuthContext(currentUrl: string, fallbackApiServerUrl: string): ServerAuthBootstrapContext | null {
  const url = new URL(currentUrl)
  const apiServerUrl = normalizeTrustedApiServerUrl(
    url.searchParams.get(API_SERVER_URL_QUERY_PARAM),
  )

  if (!apiServerUrl)
    return null

  return {
    apiServerUrl: apiServerUrl ?? fallbackApiServerUrl,
    currentUrl,
  }
}

function normalizeTrustedApiServerUrl(value: string | null): string | null {
  if (!value)
    return null

  try {
    const url = new URL(value)
    // Local servers keep their own port. Check them first, because the development
    // identity also points at localhost and must not rewrite other local ports.
    if (TRUSTED_LOCAL_API_SERVER_ORIGIN_PATTERNS.some(pattern => pattern.test(url.origin)))
      return url.origin

    // A redirect can carry the customer host with HTTP or a path. Use the configured HTTPS origin.
    if (url.hostname === trustedApiServerUrl.hostname)
      return trustedApiServerUrl.origin

    return null
  }
  catch {
    return null
  }
}
