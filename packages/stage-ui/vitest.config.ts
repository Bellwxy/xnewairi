import { cwd } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfigs } from 'unocss'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { sharedUnoConfig } from '../../uno.config'

// These tests fix or mock their own page account. The shared setup file would fix `local` first.
const accountRuntimeTests = [
  'src/services/account-startup.browser.test.ts',
  'src/services/account-startup-host.browser.test.ts',
  'src/services/account-switch.browser.test.ts',
  'src/stores/chat/session-store.browser.test.ts',
  'src/stores/chat/session-store-lifecycle.browser.test.ts',
  'src/stores/modules/airi-card-sync.browser.test.ts',
]
// Vitest names each browser instance in place, so each project needs its own object.
function browser() {
  return {
    enabled: true,
    headless: true,
    provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }),
    instances: [
      { browser: 'chromium' as const },
    ],
  }
}

export default defineConfig({
  root: import.meta.dirname,
  // Shared settings pages import these optional UI dependencies through the
  // component barrel. Bundle them before a browser test starts to avoid HMR.
  optimizeDeps: {
    include: [
      '@moeru/eventa/adapters/websocket/native',
      '@moeru/std',
      '@pinia/colada',
      '@vueuse/core',
      'embla-carousel-vue',
      'html2canvas',
      'idb-keyval',
      'node-vibrant/browser',
      'pinia',
      'pinia-plugin-synced',
      'reka-ui',
      'vaul-vue',
      'vue',
      'vue-i18n',
    ],
  },
  plugins: [
    Info(),
    // Use the app's route-block transform when browser tests mount shared pages.
    VueRouter({ routesFolder: [], dts: false }),
    Vue(),
    UnoCSS(mergeConfigs([sharedUnoConfig(), {
      // Browser tests use product styles, not Histoire's hover-preview variants.
      configFile: false,
      // Vitest loads components after the stylesheet. Scan their source before
      // the initial CSS response instead of relying on Vite's HMR updates.
      content: {
        filesystem: [
          `${import.meta.dirname}/src/**/*.vue`,
          `${import.meta.dirname}/../ui/src/**/*.vue`,
        ],
      },
    }])),
  ],
  test: {
    env: loadEnv('test', cwd(), ''),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          setupFiles: ['@proj-airi/stage-shared/account-scope/testing'],
          // NOTICE:
          // Node 26 defines a global `localStorage` getter that returns undefined without `--localstorage-file`.
          // jsdom then cannot install its own storage.
          // Source: `node -e "console.log(typeof localStorage)"` prints `undefined` with an ExperimentalWarning.
          // Remove when the supported Node version stops defining the global, or jsdom replaces it.
          execArgv: ['--no-experimental-webstorage'],
          fileParallelism: false,
          hookTimeout: 20_000,
          maxWorkers: 1,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**', ...accountRuntimeTests],
          setupFiles: ['@proj-airi/stage-shared/account-scope/testing'],
          browser: browser(),
        },
      },
      {
        extends: true,
        test: {
          name: 'browser-account-runtime',
          include: accountRuntimeTests,
          browser: browser(),
          // Browser test files share one origin. These tests write the device pointer and create databases of other accounts,
          // so they run after the other projects, which list or read that shared storage.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
