import type { ProviderErrorKind } from '@proj-airi/core-agent'

import { errorMessageFrom } from '@moeru/std'

/**
 * Response text that means the account cannot pay.
 * OpenAI and new-api style gateways send it with 401, 402, 403, or 429.
 */
const quotaPattern = /insufficient_quota|insufficient[_ ]balance|exceeded your current quota|quota exceeded|credit|balance|额度|余额|欠费/i

/** Response text that means the endpoint works but cannot serve the requested model. */
const modelPattern = /model_not_found|model\b.{1,60}(?:not[_ ]found|does not exist|not supported|unsupported|not available)|无可用渠道|模型.{0,20}(?:不存在|不支持)/i

/**
 * Messages that browsers, Node, and Electron give when no HTTP response arrives.
 * The validators abort a request after a timeout, so an abort also means no response.
 */
const networkPattern = /failed to fetch|fetch failed|networkerror|load failed|econnrefused|enotfound|etimedout|econnreset|err_name_not_resolved|err_connection|err_cert|certificate|aborted|timed? ?out/i

function responseStatus(error: unknown, message: string): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode

  // An error loses its class when it crosses a worker or IPC boundary, and validators keep only the message.
  // The xsAI message and the validator message both keep the status.
  const match = /Remote sent (\d{3}) response/.exec(message) ?? /HTTP (\d{3})/.exec(message)
  return match ? Number(match[1]) : undefined
}

/**
 * Finds the cause of a failed provider request, so that the interface can tell a user how to fix it.
 * The input can be an xsAI `APICallError`, any other error, or a validator failure reason.
 *
 * @returns `undefined` when the cause is not one that a user can fix.
 *
 * @example
 * classifyProviderError('Model list check failed: Remote sent 401 response: {"error":"invalid key"}')
 * // => 'auth'
 */
export function classifyProviderError(error: unknown): ProviderErrorKind | undefined {
  const message = typeof error === 'string' ? error : errorMessageFrom(error) ?? ''
  const status = responseStatus(error, message)
  if (status === undefined)
    return networkPattern.test(message) ? 'endpoint' : undefined

  // The response text is more specific than the status. A gateway can send 401 or 429 for an empty balance.
  if (status === 402 || quotaPattern.test(message))
    return 'quota'
  if (modelPattern.test(message))
    return 'model'
  if (status === 401 || status === 403)
    return 'auth'
  if (status === 429)
    return 'rate-limit'
  // A 404 without model text usually means that the base URL has a wrong path, for example a missing `/v1`.
  if (status === 404)
    return 'endpoint'
  return undefined
}

/**
 * Gives the settings route where a user fixes the cause.
 * A rate limit has no route, because only waiting fixes it.
 */
export function providerErrorFixRoute(kind: ProviderErrorKind, providerId: string): string | undefined {
  switch (kind) {
    case 'endpoint':
    case 'auth':
    case 'quota':
      return providerId ? `/settings/providers/chat/${providerId}` : '/settings/modules/consciousness'
    case 'model':
      return '/settings/modules/consciousness'
    case 'rate-limit':
      return undefined
  }
}
