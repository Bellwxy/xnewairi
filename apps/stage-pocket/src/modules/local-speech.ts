import type { LocalSpeechAvailability, LocalSpeechRequest } from '@proj-airi/stage-shared/local-speech'
import type { LocalSpeechHost } from '@proj-airi/stage-ui/libs/providers/providers/local-speech'

import { Capacitor, registerPlugin } from '@capacitor/core'
import { decodeBase64 } from '@moeru/std/base64'

interface LocalSpeechPlugin {
  availability: () => Promise<LocalSpeechAvailability>
  /** Resolves with base64 WAV bytes. */
  synthesize: (options: LocalSpeechRequest) => Promise<{ wav: string }>
}

const plugin = registerPlugin<LocalSpeechPlugin>('LocalSpeech')

/**
 * Returns the native offline voice of the Android package.
 * iOS has no plugin yet, so it returns no host and the built-in voice stays unavailable there.
 */
export function createLocalSpeechHost(): LocalSpeechHost | undefined {
  if (Capacitor.getPlatform() !== 'android')
    return undefined

  return {
    availability: () => plugin.availability(),
    synthesize: async (request) => {
      const { wav } = await plugin.synthesize(request)
      return new Uint8Array(decodeBase64(wav))
    },
  }
}
