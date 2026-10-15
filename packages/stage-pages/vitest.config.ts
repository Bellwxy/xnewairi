import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { sharedUnoConfig } from '../../uno.config'

// These tests fix their own page account. The shared setup file would fix `local` first.
const accountRuntimeTests = [
  'src/pages/settings/airi-card/components/CardDetailDialog.browser.test.ts',
]
// Vitest names each browser instance in place, so each project needs its own object.
function browser() {
  return {
    enabled: true,
    headless: true,
    provider: playwright(),
    instances: [
      { browser: 'chromium' as const },
    ],
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    Info(),
    Vue(),
    VueRouter({
      extensions: ['.vue'],
      dts: false,
      routesFolder: resolve(import.meta.dirname, 'src', 'pages'),
      exclude: ['**/components/**', '**/*.test.ts'],
    }),
    UnoCSS({
      ...sharedUnoConfig(),
      configFile: false,
      content: {
        filesystem: [
          `${import.meta.dirname}/src/**/*.vue`,
          `${import.meta.dirname}/../stage-ui/src/**/*.vue`,
          `${import.meta.dirname}/../ui/src/**/*.vue`,
        ],
      },
    }),
  ],
  test: {
    projects: [
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
          // Browser test files share one origin. These tests use storage of another account, so they run after the others.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
