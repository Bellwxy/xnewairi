import { APICallError } from '@xsai/shared'
import { describe, expect, it } from 'vitest'

import { classifyProviderError, providerErrorFixRoute } from './error-kind'

function apiCallError(status: number, body: string) {
  return new APICallError(`Remote sent ${status} response: ${body}`, {
    response: new Response(body, { status }),
    responseBody: body,
  })
}

describe('classifyProviderError', () => {
  it('reads the status of an xsAI error', () => {
    expect(classifyProviderError(apiCallError(401, '{"error":{"message":"Invalid API key"}}'))).toBe('auth')
    expect(classifyProviderError(apiCallError(403, 'forbidden'))).toBe('auth')
    expect(classifyProviderError(apiCallError(429, 'Rate limit reached for requests per min'))).toBe('rate-limit')
    expect(classifyProviderError(apiCallError(404, '<html>Not Found</html>'))).toBe('endpoint')
  })

  it('prefers the response text when a gateway reports an empty balance', () => {
    expect(classifyProviderError(apiCallError(402, 'payment required'))).toBe('quota')
    expect(classifyProviderError(apiCallError(429, '{"error":{"code":"insufficient_quota"}}'))).toBe('quota')
    expect(classifyProviderError(apiCallError(403, '{"error":{"message":"用户额度不足"}}'))).toBe('quota')
  })

  it('finds a model that the endpoint cannot serve', () => {
    expect(classifyProviderError(apiCallError(404, '{"error":{"code":"model_not_found"}}'))).toBe('model')
    expect(classifyProviderError(apiCallError(400, 'The model `gpt-9` does not exist'))).toBe('model')
    expect(classifyProviderError(apiCallError(503, '当前分组 default 下对于模型 gpt-9 无可用渠道'))).toBe('model')
  })

  it('reads the status from a message that lost its error class', () => {
    expect(classifyProviderError(new Error('Remote sent 401 response: unauthorized'))).toBe('auth')
    expect(classifyProviderError('Model list check failed: Remote sent 401 response: {}')).toBe('auth')
  })

  it('treats a missing response as an endpoint failure', () => {
    expect(classifyProviderError(new TypeError('Failed to fetch'))).toBe('endpoint')
    expect(classifyProviderError('Connectivity check failed: fetch failed')).toBe('endpoint')
    expect(classifyProviderError('Connectivity check failed: This operation was aborted')).toBe('endpoint')
  })

  it('leaves other causes unclassified', () => {
    expect(classifyProviderError(apiCallError(500, 'internal error'))).toBeUndefined()
    expect(classifyProviderError(new Error('The target session has no character'))).toBeUndefined()
    expect(classifyProviderError('Base URL is invalid. It must be an absolute URL.')).toBeUndefined()
  })
})

describe('providerErrorFixRoute', () => {
  it('opens the page that owns the cause', () => {
    expect(providerErrorFixRoute('auth', 'openai-compatible')).toBe('/settings/providers/chat/openai-compatible')
    expect(providerErrorFixRoute('endpoint', '')).toBe('/settings/modules/consciousness')
    expect(providerErrorFixRoute('model', 'openai-compatible')).toBe('/settings/modules/consciousness')
    expect(providerErrorFixRoute('rate-limit', 'openai-compatible')).toBeUndefined()
  })
})
