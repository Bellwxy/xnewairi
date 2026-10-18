import { env } from 'node:process'

// NOTICE:
// Vite configs load this workspace file through native Node ESM, not through the Vite bundler.
// Native ESM rejects the extensionless `./config` import with ERR_MODULE_NOT_FOUND.
// The package self-reference resolves through the `exports` field of `package.json` instead.
// Remove this when Vite bundles linked workspace files during config loading.
import { resolveBrand } from '@proj-airi/stage-shared/brand/config'

/** Injects the same public identity into browser, Electron main, and Electron renderer builds. */
export function brandPlugin() {
  return {
    name: 'stage-brand',
    config(_config: unknown, context: { command: string }) {
      resolveBrand(env.AIRI_BRAND_JSON, context.command === 'build')
      return {
        define: {
          'import.meta.env.AIRI_BRAND_JSON': JSON.stringify(env.AIRI_BRAND_JSON ?? ''),
        },
      }
    },
  }
}
