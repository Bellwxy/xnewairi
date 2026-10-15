import Info from 'unplugin-info/vite'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Stage UI stores reach build metadata through `~build/*` virtual modules.
  plugins: [Info()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['@proj-airi/stage-shared/account-scope/testing'],
    // NOTICE:
    // Node 26 defines a global `localStorage` getter that returns undefined without `--localstorage-file`.
    // jsdom then cannot install its own storage.
    // Source: `node -e "console.log(typeof localStorage)"` prints `undefined` with an ExperimentalWarning.
    // Remove when the supported Node version stops defining the global, or jsdom replaces it.
    execArgv: ['--no-experimental-webstorage'],
  },
})
