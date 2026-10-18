import { brand } from '@proj-airi/stage-shared/brand'

export interface DesktopAuthConfiguration {
  clientId: string
  serverUrl: string
}

export const desktopAuthConfiguration: DesktopAuthConfiguration = {
  clientId: brand.desktopOidcClientId,
  serverUrl: brand.serverUrl,
}
