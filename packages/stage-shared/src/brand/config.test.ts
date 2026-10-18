import { afterEach, describe, expect, it, vi } from 'vitest'

import { brandPlugin } from './build'
import { resolveBrand } from './config'

const customer = {
  productName: 'Customer Companion',
  desktopAppId: 'com.customer.desktop',
  pocketAppId: 'com.customer.pocket',
  callbackScheme: 'com.customer.pocket',
  serverUrl: 'https://api.customer.example/',
  inferenceBaseUrl: 'https://gateway.customer.example/v1/',
  inferenceModel: 'customer-chat',
  termsUrl: 'https://customer.example/terms',
  privacyUrl: 'https://customer.example/privacy',
  updateRepository: 'customer/companion',
  desktopOidcClientId: 'customer-desktop',
  pocketOidcClientId: 'customer-pocket',
  webOidcClientId: 'customer-web',
  itchTarget: '',
}

afterEach(() => vi.unstubAllEnvs())

describe('customer build identity', () => {
  it('injects the customer identity and preserves its legal URLs', () => {
    const json = JSON.stringify(customer)
    vi.stubEnv('AIRI_BRAND_JSON', json)
    expect(brandPlugin().config({}, { command: 'build' }).define).toEqual({
      'import.meta.env.AIRI_BRAND_JSON': JSON.stringify(json),
    })
    expect(resolveBrand(json, true)).toEqual({ ...customer, serverUrl: 'https://api.customer.example' })
    expect(Object.isFrozen(resolveBrand(json, true))).toBe(true)
  })

  it('permits only local development when the customer configuration is absent', () => {
    vi.stubEnv('AIRI_BRAND_JSON', '')
    expect(resolveBrand(undefined).serverUrl).toBe('http://localhost:3000')
    expect(resolveBrand(undefined).updateRepository).toBe('')
    expect(() => brandPlugin().config({}, { command: 'build' })).toThrow('AIRI_BRAND_JSON is required')
    expect(() => resolveBrand('{}', true)).toThrow()
  })

  it.each([
    { productName: 'AIRI' },
    { desktopAppId: 'ai.moeru.airi' },
    { pocketAppId: 'com.customer.desktop' },
    { serverUrl: 'https://api.airi.build' },
    { inferenceBaseUrl: 'https://api.airi.build/v1/' },
    { inferenceBaseUrl: 'http://gateway.customer.example/v1/' },
    { termsUrl: 'https://airi.moeru.ai/docs/en/about/terms' },
    { privacyUrl: 'http://customer.example/privacy' },
    { updateRepository: 'moeru-ai/airi' },
    { itchTarget: 'nekomeowww/airi' },
  ])('rejects unsafe customer configuration: %j', (override) => {
    expect(() => resolveBrand(JSON.stringify({ ...customer, ...override }), true)).toThrow()
  })
})
