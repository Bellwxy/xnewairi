interface StartupFallbackMessages {
  stage?: { startup?: { 'failed'?: string, 'retry'?: string, 'webview-outdated'?: string } }
  settings?: { dialogs?: { onboarding?: { retry?: string } } }
}

/**
 * Serializes boot error labels for pages that run before Vue.
 * The inline boot splash reads `failed` and `retry`. The Android outdated WebView page reads `webviewOutdated`.
 */
export function serializeStartupFallbackLocales(locales: Record<string, StartupFallbackMessages>, localeRemap: Record<string, string>): string {
  const english = locales.en?.stage?.startup
  if (!english?.failed || !english.retry || !english['webview-outdated'])
    throw new Error('English startup error labels are required')

  const labels = Object.fromEntries(Object.entries(locales).map(([locale, messages]) => [locale, {
    failed: messages.stage?.startup?.failed ?? english.failed,
    retry: messages.stage?.startup?.retry ?? messages.settings?.dialogs?.onboarding?.retry ?? english.retry,
    webviewOutdated: messages.stage?.startup?.['webview-outdated'] ?? english['webview-outdated'],
  }]))

  return JSON.stringify({ labels, localeRemap }).replaceAll('<', '\\u003c')
}
