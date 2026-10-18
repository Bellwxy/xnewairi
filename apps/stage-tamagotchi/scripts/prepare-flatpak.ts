import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

import { resolveBrand } from '@proj-airi/stage-shared/brand/config'

/**
 * Generates customer-owned Flatpak resources before the native package build.
 *
 * Call stack:
 * build:flatpak / release-tamagotchi
 *   -> prepare-flatpak
 *     -> resolveBrand
 *     -> Flatpak templates -> generated resources
 */
async function main() {
  const brand = resolveBrand(env.AIRI_BRAND_JSON, true)
  const root = join(import.meta.dirname, '..')
  const replacements = {
    $BRAND_APP_ID: brand.desktopAppId,
    $BRAND_PRODUCT_NAME: brand.productName,
    $BRAND_HOMEPAGE: new URL(brand.termsUrl).origin,
    $BRAND_REPOSITORY: brand.updateRepository,
  }

  for (const [template, output] of [
    ['manifest.yml', 'brand.flatpak.yml'],
    ['app.desktop', 'brand.desktop'],
    ['app.metainfo.xml', 'brand.metainfo.xml'],
  ]) {
    let content = await readFile(join(root, 'build', 'flatpak', template), 'utf8')
    for (const [token, value] of Object.entries(replacements))
      content = content.replaceAll(token, value)
    await writeFile(join(root, output), content)
  }
}

await main()
