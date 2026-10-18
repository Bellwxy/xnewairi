/* eslint-disable no-template-curly-in-string */

import type { Configuration } from 'electron-builder'

import { execSync } from 'node:child_process'
import { env } from 'node:process'

import { resolveBrand } from '@proj-airi/stage-shared/brand/config'
import { isCI, isMacOS } from 'std-env'

const brand = resolveBrand(env.AIRI_BRAND_JSON)
// Developers without certificates can package an app directory for local tests.
// CI and every installer target keep the signing and notarization requirements.
const allowUnsignedDirectory = env.AIRI_ALLOW_UNSIGNED === '1' && !isCI
const [owner, repo] = brand.updateRepository.split('/')
const publish = brand.updateRepository ? { provider: 'github', owner, repo, channel: 'latest-${arch}' } as const : null

function hasXcode26OrAbove() {
  if (!isMacOS)
    return false
  try {
    const output = execSync('xcodebuild -version')
      .toString()

      .match(/Xcode (\d+)/)
    if (!output)
      return false
    return Number.parseInt(output[1], 10) >= 26
  }
  catch {
    return false
  }
}

/**
 * Determine whether to use the .icon format for the macOS app icon based on the
 * Xcode version while building.
 * This is friendly to developers whose macOS and/or Xcode versions are below 26.
 */
const useIconFormattedMacAppIcon = hasXcode26OrAbove()
if (!useIconFormattedMacAppIcon) {
  console.warn('[electron-builder/config] Warning: Xcode version is below 26. Using .icns format for macOS app icon.')
}
else {
  // NOTICE: This success-path message intentionally uses stderr via `console.warn`.
  // The artifact metadata CLI imports this config and is used in GitHub Actions
  // command substitution for `GITHUB_ENV`; writing this log to stdout would break
  // machine-readable output such as `BUNDLE_NAME=$(...)`.
  console.warn('[electron-builder/config] Xcode version is 26 or above. Using .icon format for macOS app icon.')
}

export default {
  appId: brand.desktopAppId,
  productName: brand.productName,
  forceCodeSigning: !allowUnsignedDirectory,
  beforePack: async (context) => {
    resolveBrand(env.AIRI_BRAND_JSON, true)
    if (allowUnsignedDirectory) {
      if (context.targets.some(target => target.name !== 'dir'))
        throw new Error('AIRI_ALLOW_UNSIGNED permits only local directory builds. Run electron-builder with --dir.')
      return
    }
    if (context.electronPlatformName === 'darwin') {
      const appleIdCredentials = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID
      const apiKeyCredentials = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER
      // Electron Builder skips notarization without credentials, even when notarize is true.
      if (!appleIdCredentials && !apiKeyCredentials && !env.APPLE_KEYCHAIN_PROFILE)
        throw new Error('macOS customer packages require Apple notarization credentials.')
    }
  },
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  files: [
    'out/**',
    'resources/**',
    'package.json',
    // NOTICE: Exclude npm `electron` package from app payload.
    // Electron runtime is already provided by the outer app bundle; bundling a nested
    // `node_modules/electron/dist/Electron.app` makes electron-builder deep-sign it and
    // fails on non-code resources (for example `locale.pak`) with timestamp/signing errors.
    '!**/node_modules/electron{,/**}',
    // Workspace hoisting exposes build tools to electron-builder's file walk.
    // The packaged app has no runtime import of these tools.
    '!**/node_modules/@rolldown{,/**}',
    '!**/node_modules/rolldown{,/**}',
    '!**/node_modules/lightningcss{,/**}',
    '!**/node_modules/lightningcss-*{,/**}',
    '!**/node_modules/fsevents{,/**}',
    // Transformers runs inside browser workers in the desktop app. Sharp is its
    // Node-only image backend and has no packaged main-process consumer.
    '!**/node_modules/sharp{,/**}',
    '!**/node_modules/@img/sharp-*{,/**}',
    // uiohook-napi loads the selected prebuild. Its bundled libuiohook C source is
    // only used to build that binary and does not participate in runtime loading.
    '!**/node_modules/uiohook-napi/libuiohook{,/**}',
    '!**/.vscode/*',
    '!src/**/*',
    '!**/node_modules/**/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/**/{.turbo,test,src,__tests__,tests,example,examples}',
    '**/node_modules/debug/**/*',
    '**/node_modules/superjson/**/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!vite.config.{js,ts,mjs,cjs}',
    '!uno.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.ts,.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json}',
  ],
  asar: true,
  asarUnpack: [
    '**/*.node',
    '**/node_modules/@auv-js/cli-*/bin/**',
    // The sherpa-onnx addon loads the ONNX Runtime and sherpa-onnx shared libraries next to its `.node` file.
    '**/node_modules/sherpa-onnx-*/**',
  ],
  extraResources: [
    {
      from: '../../engines/stage-tamagotchi-godot/out/${os}',
      to: 'godot-stage',
      filter: ['**/*'],
    },
    // The offline voice model. The native runtime reads it by file path, so it stays outside `app.asar`.
    {
      from: 'local-tts',
      to: 'local-tts',
      filter: ['**/*'],
    },
  ],
  extraMetadata: {
    name: brand.desktopAppId,
    main: 'out/main/index.js',
    homepage: new URL(brand.termsUrl).origin,
    repository: `https://github.com/${brand.updateRepository}`,
    license: 'MIT',
  },
  // macOS and Windows omit `executableName`. Electron Builder then names the app bundle and
  // the executable after `productName`, which users see in Finder, Explorer, and Task Manager.
  // Linux keeps the application ID because the Flatpak manifest launches that binary.
  win: {
    // NOTICE: Keep `channel: 'latest-${arch}'` for architecture-aware updater metadata.
    // electron-builder expands `${arch}` at publish-time (for example: `latest-x64`, `latest-arm64`),
    // and electron-updater later consumes that expanded channel to resolve platform-specific *.yml files.
    // This prevents cross-arch lookups such as arm64 clients reading x64 metadata.
    publish,
  },
  nsis: {
    artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always',
    deleteAppDataOnUninstall: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: true,
  },
  mac: {
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // NOTICE: Same channel rule as Windows. Keep `${arch}` here so generated metadata resolves
    // to architecture-specific update feeds on macOS (for example: `latest-x64-mac.yml`, `latest-arm64-mac.yml`).
    publish,
    extendInfo: {
      NSAppleEventsUsageDescription: `${brand.productName} uses Automation to control apps for computer-use tasks.`,
      NSMicrophoneUsageDescription: `${brand.productName} uses the microphone for voice interaction.`,
      NSSpeechRecognitionUsageDescription: `${brand.productName} uses Apple Speech to transcribe voice interactions on this device.`,
      NSCameraUsageDescription: `${brand.productName} uses the camera for vision understanding.`,
      NSBluetoothAlwaysUsageDescription: `${brand.productName} uses Bluetooth to read game controller input.`,
    },
    hardenedRuntime: true,
    notarize: true,
    icon: useIconFormattedMacAppIcon ? 'icon.icon' : 'icon.icns',
  },
  dmg: {
    artifactName: '${productName}-${version}-darwin-${arch}.${ext}',
  },
  linux: {
    target: [
      'deb',
      'rpm',
    ],
    // NOTICE: Same channel rule as Windows/macOS. Keep `${arch}` to avoid x64/arm64 feed collisions on Linux.
    publish,
    category: 'Utility',
    synopsis: 'AI VTuber/Waifu chatbot app inspired by Neuro-sama.',
    description: `${brand.productName} is an AI companion with Live2D and VRM avatars.`,
    executableName: brand.desktopAppId,
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    icon: 'build/icons/icon.png',
  },
  appImage: {
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  npmRebuild: false,

} satisfies Configuration
