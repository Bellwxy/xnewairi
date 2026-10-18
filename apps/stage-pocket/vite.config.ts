/// <reference types="./vite.config-env.d.ts" />

import type { PluginOption } from 'vite'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import messages from '@proj-airi/i18n/locales'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'
import mkcert from 'vite-plugin-mkcert'
import VueDevTools from 'vite-plugin-vue-devtools'
import Layouts from 'vite-plugin-vue-layouts'
import VueMacros from 'vue-macros/vite'
import VueRouter from 'vue-router/vite'

import { tryCatch } from '@moeru/std'
import { localeRemap, serializeStartupFallbackLocales } from '@proj-airi/i18n'
import { paraformerBilingualZhEn, xAsrBilingualZhEnInt8, zipformerMultilingual } from '@proj-airi/provider-inference/sherpaw-transcription/models'
import { brandPlugin } from '@proj-airi/stage-shared/brand/build'
import { androidLocalSpeechModel, androidSherpaOnnxLibrary } from '@proj-airi/stage-shared/local-speech-model'
import { kwsModel } from '@proj-airi/stage-ui/libs/voice/kws-model-info'
import { Download } from '@proj-airi/unplugin-fetch/vite'
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk/vite'
import { Sherpaw } from '@proj-airi/vite-plugin-sherpaw'
import { defineConfig } from 'vite'

// import { isEnvTruthy } from '@proj-airi/stage-shared'
function isEnvTruthy(value: string | undefined | null): boolean {
  if (value == null)
    return false

  return /^(?:1|true|t|yes|y|on)$/i.test(value.trim())
}

const stageUIAssetsRoot = resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src', 'assets'))
const sharedCacheDir = resolve(join(import.meta.dirname, '..', '..', '.cache'))

async function exists(path: string) {
  return await access(path).then(() => true, () => false)
}

/** Downloads a pinned file into the shared cache once, and rejects a file whose digest changed. */
async function cachedDownload(file: { url: string, sha256: string }) {
  const path = join(sharedCacheDir, 'local-speech', file.sha256)
  if (!await exists(path)) {
    const response = await fetch(file.url)
    if (!response.ok)
      throw new Error(`Failed to download ${file.url}: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== file.sha256)
      throw new Error(`${file.url} has digest ${digest}, expected ${file.sha256}.`)
    await mkdir(join(sharedCacheDir, 'local-speech'), { recursive: true })
    await writeFile(path, data)
  }
  return path
}

/**
 * Places the offline voice for the Android plugin before Gradle runs.
 * The app module compiles against the sherpa-onnx AAR, so development builds need it too.
 */
function LocalSpeechAndroidAssets(): PluginOption {
  const androidApp = join(import.meta.dirname, 'android', 'app')
  return {
    name: 'airi-local-speech-android-assets',
    async configResolved() {
      const libraryPath = join(androidApp, 'libs', androidSherpaOnnxLibrary.filename)
      if (!await exists(libraryPath)) {
        const cached = await cachedDownload(androidSherpaOnnxLibrary)
        await mkdir(join(androidApp, 'libs'), { recursive: true })
        await copyFile(cached, libraryPath)
      }

      const assetsRoot = join(androidApp, 'src', 'main', 'assets', 'local-tts')
      if (await exists(join(assetsRoot, androidLocalSpeechModel.directory, androidLocalSpeechModel.model)))
        return
      const archive = await cachedDownload(androidLocalSpeechModel.archive)
      // Node has no bzip2 decoder. The `tar` of macOS, Linux, and Windows 10 and later reads bzip2 archives.
      await rm(join(assetsRoot, androidLocalSpeechModel.directory), { recursive: true, force: true })
      await mkdir(assetsRoot, { recursive: true })
      execFileSync('tar', ['-xjf', archive, '-C', assetsRoot])
      // A partial extraction leaves no model file, so the next build extracts again.
      if (!await exists(join(assetsRoot, androidLocalSpeechModel.directory, androidLocalSpeechModel.model)))
        throw new Error(`The archive ${androidLocalSpeechModel.archive.url} has no ${androidLocalSpeechModel.model}.`)
    },
  }
}

export default defineConfig({
  optimizeDeps: {
    exclude: [
      // Internal Packages
      '@proj-airi/stage-ui/*',
      '@proj-airi/drizzle-duckdb-wasm',
      '@proj-airi/drizzle-duckdb-wasm/*',

      // Static Assets: Models, Images, etc.
      'public/assets/*',

      // Live2D SDK
      '@framework/live2dcubismframework',
      '@framework/math/cubismmatrix44',
      '@framework/type/csmvector',
      '@framework/math/cubismviewmatrix',
      '@framework/cubismdefaultparameterid',
      '@framework/cubismmodelsettingjson',
      '@framework/effect/cubismbreath',
      '@framework/effect/cubismeyeblink',
      '@framework/model/cubismusermodel',
      '@framework/motion/acubismmotion',
      '@framework/motion/cubismmotionqueuemanager',
      '@framework/type/csmmap',
      '@framework/utils/cubismdebug',
      '@framework/model/cubismmoc',
    ],
  },
  resolve: {
    alias: {
      '@proj-airi/server-sdk': resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-sdk', 'src')),
      '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      '@proj-airi/stage-ui': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')),
      '@proj-airi/stage-layouts': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src')),
      '@proj-airi/stage-pages': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src')),
      '@proj-airi/stage-shared': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-shared', 'src')),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5273,
    fs: {
      // To mute errors like:
      //   The request id ".../node_modules/@fontsource/sniglet/files/sniglet-latin-400-normal.woff" is outside of Vite serving allow list.
      //
      // See: https://vite.dev/config/server-options#server-fs-strict
      strict: false,
    },
    warmup: {
      clientFiles: [
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src'))}/*.vue`,
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src'))}/*.vue`,
        `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src'))}/*.vue`,
      ],
    },
  },
  build: {
    sourcemap: true,
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
      },
    },
  },

  plugins: [
    brandPlugin(),
    LocalSpeechAndroidAssets(),
    {
      name: 'airi-startup-locales',
      transformIndexHtml: html => html.replace('__AIRI_STARTUP_LOCALES__', serializeStartupFallbackLocales(messages, localeRemap)),
    },
    ...isEnvTruthy(process.env.VITE_SKIP_MKCERT ?? '')
      ? []
      : [mkcert((() => {
          // Workaround: plugin's bundled downloader has a feaxios bug, prefer system mkcert
          const command = process.platform === 'win32' ? 'where' : 'which'

          const { data } = tryCatch(() => ({ mkcertPath: execSync(`${command} mkcert`, { stdio: 'pipe' }).toString().trim().split(/\r?\n/)[0] }))
          return data
        })())],

    Info(),
    // Pocket always bundles the small wake word model. Release builds also bundle Paraformer, the recognizer that mobile selects.
    Sherpaw({
      models: [paraformerBilingualZhEn, zipformerMultilingual, xAsrBilingualZhEnInt8, kwsModel],
      developmentModels: [kwsModel],
      // Mobile selects Paraformer for Chinese and English, so release builds package it for offline first use.
      bundledModels: process.env.SHERPAW_BUNDLE_MODELS === 'true' ? [paraformerBilingualZhEn, kwsModel] : [kwsModel],
      cacheDir: sharedCacheDir,
    }),

    Yaml(),

    VueMacros({
      plugins: {
        vue: Vue({
          include: [/\.vue$/, /\.md$/],
          ...templateCompilerOptions,
        }),
        vueJsx: false,
      },
      betterDefine: false,
    }),

    VueRouter({
      extensions: ['.vue', '.md'],
      dts: resolve(import.meta.dirname, 'src/typed-router.d.ts'),
      importMode: 'async',
      routesFolder: [
        resolve(import.meta.dirname, 'src', 'pages'),
        {
          src: resolve(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src', 'pages'),
          exclude: base => [
            ...base,
            '**/settings/connection/index.vue',
            '**/settings/modules/beat-sync.vue',
            // Customer builds route every LLM request to the brand gateway. Hide provider and endpoint pages.
            '**/settings/providers/index.vue',
            '**/settings/providers/artistry/**',
            '**/settings/providers/speech/**',
            '**/settings/providers/transcription/**',
            '**/settings/providers/vision/**',
            '**/settings/providers/chat/amazon-bedrock.vue',
            '**/settings/providers/chat/azure-ai-foundry.vue',
            '**/settings/providers/chat/cloudflare-workers-ai.vue',
            '**/settings/providers/chat/lm-studio.vue',
            '**/settings/providers/chat/ollama.vue',
            '**/settings/providers/chat/prompt-api.vue',
            '**/v2/settings/providers.vue',
            '**/v2/settings/providers/**',
            // The product has no messaging, social, or game integrations.
            '**/settings/modules/gaming-factorio.vue',
            '**/settings/modules/gaming-minecraft.vue',
            '**/settings/modules/messaging-discord.vue',
            '**/settings/modules/x.vue',
            '**/settings/modules/home-assistant.vue',
            '**/settings/modules/mcp.vue',
          ],
        },
      ],
      exclude: ['**/components/**'],
    }),

    // https://github.com/JohnCampionJr/vite-plugin-vue-layouts
    Layouts({
      layoutsDirs: [
        resolve(import.meta.dirname, 'src', 'layouts'),
        resolve(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src', 'layouts'),
      ],
    }),

    // https://github.com/antfu/unocss
    // see uno.config.ts for config
    Unocss(),

    // https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n
    VueI18n({
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
    }),

    // https://github.com/webfansplz/vite-plugin-vue-devtools
    VueDevTools(),

    DownloadLive2DSDK(),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip', 'hiyori_free_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip', 'hiyori_pro_zh.zip', 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm', 'AvatarSample_A.vrm', 'vrm/models/AvatarSample-A', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm', 'AvatarSample_B.vrm', 'vrm/models/AvatarSample-B', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),

    ...isEnvTruthy(process.env.VITE_CAP_SYNC_IOS_AFTER_BUILD ?? '')
      ? [{
          name: 'proj-airi:capacitor-sync',
          closeBundle: {
            sequential: true,
            handler() {
              if (this.meta.watchMode) {
                execSync('cap sync ios', { stdio: 'inherit' })
              }
            },
          },
        } as PluginOption]
      : [],

    {
      name: 'proj-airi:defines',
      config(ctx) {
        const define: Record<string, any> = {
          'import.meta.env.RUNTIME_ENVIRONMENT': '\'capacitor\'',
        }
        if (ctx.mode === 'development') {
          define['import.meta.env.URL_MODE'] = '\'server\''
        }
        if (ctx.mode === 'production') {
          define['import.meta.env.URL_MODE'] = '\'file\''
        }

        return { define }
      },
    },
  ],
})
