import * as v from 'valibot'

const identifier = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/))
const clientId = v.pipe(v.string(), v.regex(/^[\w.-]+$/))
const repository = v.pipe(v.string(), v.regex(/^[\w-]+\/[\w.-]+$/))
const httpsUrl = v.pipe(v.string(), v.url(), v.check((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Use an HTTPS URL without credentials.'))

const schema = v.strictObject({
  productName: v.pipe(v.string(), v.regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u)),
  desktopAppId: identifier,
  pocketAppId: identifier,
  callbackScheme: identifier,
  serverUrl: httpsUrl,
  // The OpenAI-compatible chat endpoint that customers use with their own key. An empty value lets customers enter it.
  inferenceBaseUrl: v.optional(v.union([v.literal(''), httpsUrl]), ''),
  // The chat model that onboarding selects. An empty value selects the first model that the gateway lists.
  inferenceModel: v.optional(v.pipe(v.string(), v.trim()), ''),
  termsUrl: httpsUrl,
  privacyUrl: httpsUrl,
  updateRepository: repository,
  desktopOidcClientId: clientId,
  pocketOidcClientId: clientId,
  webOidcClientId: clientId,
  itchTarget: v.optional(v.union([v.literal(''), repository]), ''),
})

/** Public build identity. Credentials must not enter this object or the application bundle. */
export type BrandConfig = v.InferOutput<typeof schema>

const development: Readonly<BrandConfig> = Object.freeze({
  productName: 'Local Development',
  desktopAppId: 'local.development.desktop',
  pocketAppId: 'local.development.pocket',
  callbackScheme: 'local.development.pocket',
  serverUrl: 'http://localhost:3000',
  inferenceBaseUrl: '',
  inferenceModel: '',
  termsUrl: 'http://localhost:3000/terms',
  privacyUrl: 'http://localhost:3000/privacy',
  updateRepository: '',
  desktopOidcClientId: 'local-desktop',
  pocketOidcClientId: 'local-pocket',
  webOidcClientId: 'local-web',
  itchTarget: '',
})

function isUpstreamUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase()
  return ['airi.build', 'moeru.ai'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * Rejects incomplete customer identities and upstream destinations.
 * Only development permits a missing value and uses isolated local services.
 */
export function resolveBrand(json: string | undefined, requireCustomer = false): Readonly<BrandConfig> {
  if (!json?.trim()) {
    if (requireCustomer)
      throw new Error('AIRI_BRAND_JSON is required for customer builds.')
    return development
  }

  const brand = v.parse(schema, JSON.parse(json))
  if (brand.productName.toUpperCase() === 'AIRI'
    || [brand.desktopAppId, brand.pocketAppId, brand.callbackScheme].some(value => value.startsWith('ai.moeru.airi'))
    || brand.desktopAppId === brand.pocketAppId
    || [brand.serverUrl, brand.inferenceBaseUrl, brand.termsUrl, brand.privacyUrl].some(value => value && isUpstreamUrl(value))
    || brand.updateRepository.toLowerCase() === 'moeru-ai/airi'
    || brand.itchTarget.toLowerCase() === 'nekomeowww/airi') {
    throw new Error('Use a distinct customer identity and customer-owned service and release destinations.')
  }

  return Object.freeze({ ...brand, serverUrl: brand.serverUrl.replace(/\/+$/, '') })
}
