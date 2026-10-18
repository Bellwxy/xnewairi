import type { CapacitorConfig } from '@capacitor/cli'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

import { resolveBrand } from '@proj-airi/stage-shared/brand/config'

const serverURL = env.CAPACITOR_DEV_SERVER_URL

const brand = resolveBrand(env.AIRI_BRAND_JSON, !serverURL)
const teamId = env.APPLE_TEAM_ID ?? ''
if (!/^[A-Z0-9]*$/.test(teamId))
  throw new Error('APPLE_TEAM_ID must contain only uppercase letters and digits.')

// Native builds consume generated identity files, not separate platform defaults.
writeFileSync(join(__dirname, 'android', 'brand.json'), JSON.stringify(brand, null, 2))
writeFileSync(join(__dirname, 'ios', 'brand.xcconfig'), [
  `AIRI_PRODUCT_NAME = ${brand.productName}`,
  `AIRI_POCKET_APP_ID = ${brand.pocketAppId}`,
  `AIRI_CALLBACK_SCHEME = ${brand.callbackScheme}`,
  `DEVELOPMENT_TEAM = ${teamId}`,
  '',
].join('\n'))

const config: CapacitorConfig = {
  appId: brand.pocketAppId,
  appName: brand.productName,
  webDir: 'dist',
  server: serverURL
    ? {
        url: serverURL,
        cleartext: false,
      }
    : undefined,
  android: {
    buildOptions: {
      keystorePath: env.CAPACITOR_ANDROID_KEYSTORE_PATH,
      keystoreAlias: env.CAPACITOR_ANDROID_KEYSTORE_ALIAS,
      keystorePassword: env.CAPACITOR_ANDROID_KEYSTORE_PASSWORD,
      keystoreAliasPassword: env.CAPACITOR_ANDROID_KEYSTORE_ALIAS_PASSWORD,
      releaseType: 'APK',
      signingType: 'apksigner',
    },
  },
}

export default config
