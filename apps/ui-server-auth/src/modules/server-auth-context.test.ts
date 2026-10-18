// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { getServerAuthBootstrapContext, resolveStandaloneServerAuthContext } from './server-auth-context'

// The trusted API origin comes from the build identity, so it must exist before the module loads.
vi.hoisted(() => {
  vi.stubEnv('AIRI_BRAND_JSON', JSON.stringify({
    productName: 'Customer Companion',
    desktopAppId: 'com.customer.desktop',
    pocketAppId: 'com.customer.pocket',
    callbackScheme: 'com.customer.pocket',
    serverUrl: 'https://api.customer.example',
    termsUrl: 'https://customer.example/terms',
    privacyUrl: 'https://customer.example/privacy',
    updateRepository: 'customer/companion',
    desktopOidcClientId: 'customer-desktop',
    pocketOidcClientId: 'customer-pocket',
    webOidcClientId: 'customer-web',
  }))
})

describe('ui-server-auth bootstrap context', () => {
  it('uses the configured API server origin carried by standalone server redirects', () => {
    const currentUrl = 'https://accounts.customer.example/ui/sign-in?api_server_url=https%3A%2F%2Fapi.customer.example%2Fapi%2Fauth&client_id=customer-web'

    expect(resolveStandaloneServerAuthContext(currentUrl, 'https://api.customer.example')).toEqual({
      apiServerUrl: 'https://api.customer.example',
      currentUrl,
    })
  })

  it('ignores upstream API server origins', () => {
    expect(resolveStandaloneServerAuthContext(
      'https://accounts.customer.example/ui/sign-in?api_server_url=https%3A%2F%2Fapi-dev.airi.build&client_id=customer-web',
      'https://api.customer.example',
    )).toBeNull()
  })

  it('ignores untrusted API server origins from crafted standalone auth URLs', () => {
    expect(resolveStandaloneServerAuthContext(
      'https://accounts.customer.example/ui/sign-in?api_server_url=https%3A%2F%2Fevil.example&client_id=customer-web',
      'https://api.customer.example',
    )).toBeNull()
  })

  it('allows localhost API origins for local development', () => {
    expect(resolveStandaloneServerAuthContext(
      'http://localhost:5173/ui/sign-in?api_server_url=http%3A%2F%2F127.0.0.1%3A3000',
      'https://api.customer.example',
    )?.apiServerUrl).toBe('http://127.0.0.1:3000')
  })

  it('normalizes the configured API host to HTTPS when typed with HTTP', () => {
    expect(resolveStandaloneServerAuthContext(
      'https://accounts.customer.example/ui/sign-in?api_server_url=http%3A%2F%2Fapi.customer.example',
      'http://localhost:3000',
    )?.apiServerUrl).toBe('https://api.customer.example')
  })

  it('falls back to the standalone query context when the static placeholder script is still present', () => {
    document.body.innerHTML = '<script id="airi-server-auth-context" type="application/json">__AIRI_SERVER_AUTH_CONTEXT__</script>'
    window.history.replaceState(
      null,
      '',
      '/ui/sign-in?api_server_url=https%3A%2F%2Fapi.customer.example',
    )

    expect(getServerAuthBootstrapContext()?.apiServerUrl).toBe('https://api.customer.example')
  })
})
