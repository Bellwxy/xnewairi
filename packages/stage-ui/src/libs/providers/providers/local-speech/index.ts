import type { LocalSpeechAvailability, LocalSpeechRequest } from '@proj-airi/stage-shared/local-speech'

import { z } from 'zod'

import { defineProvider } from '../registry'

/**
 * Native synthesis that the application host owns.
 * Desktop forwards requests to the Electron main process. Android forwards them to its Capacitor plugin.
 */
export interface LocalSpeechHost {
  availability: () => Promise<LocalSpeechAvailability>
  /** Resolves with WAV bytes. */
  synthesize: (request: LocalSpeechRequest) => Promise<Uint8Array<ArrayBuffer>>
}

/**
 * Each package contains one voice, so the model and voice IDs are fixed.
 * The host chooses the model: desktop runs MeloTTS, and Android runs a faster Piper voice.
 */
const modelId = 'built-in'
const voiceId = 'built-in'

let host: LocalSpeechHost | undefined

/** Each host registers its native synthesis at startup. Web has no host, so the provider reports it as unavailable. */
export function setLocalSpeechHost(value: LocalSpeechHost): void {
  host = value
}

async function localSpeechAvailability(): Promise<LocalSpeechAvailability> {
  if (!host)
    return { available: false, reason: 'This platform has no built-in voice.' }
  return await host.availability()
}

export const providerLocalSpeech = defineProvider({
  id: 'local-speech',
  order: 0,
  name: 'Built-in voice',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.local-speech.title'),
  description: 'Offline Chinese voice in the application package.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.local-speech.description'),
  tasks: ['text-to-speech'],
  icon: 'i-solar:soundwave-bold-duotone',
  requiresCredentials: false,
  createProviderConfig: () => z.object({}),
  createProvider() {
    return {
      speech: () => ({
        baseURL: 'http://local-speech.invalid/v1/',
        model: modelId,
        // The xsAI speech request becomes a native call. The response keeps the shape of an OpenAI speech response.
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!host)
            throw new Error('This platform has no built-in voice.')
          if (typeof init?.body !== 'string')
            throw new Error('Invalid request body')

          const body = JSON.parse(init.body) as { input?: string, speed?: number }
          const wav = await host.synthesize({ text: body.input ?? '', speed: body.speed })
          return new Response(wav, {
            status: 200,
            headers: { 'Content-Type': 'audio/wav' },
          })
        },
      }),
    }
  },
  validationRequiredWhen: () => true,
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'local-speech:check-availability',
        name: t('settings.pages.providers.provider.local-speech.title'),
        validator: async () => {
          const { available, reason } = await localSpeechAvailability()
          return {
            errors: available ? [] : [{ error: new Error(reason) }],
            reason: available ? '' : reason ?? '',
            reasonKey: '',
            valid: available,
          }
        },
      }),
    ],
  },
  extraMethods: {
    listModels: async () => [{
      id: modelId,
      name: 'Built-in voice',
      provider: 'local-speech',
    }],
    voiceCatalogConfig: () => ({}),
    listVoices: async () => [{
      id: voiceId,
      name: 'Built-in voice',
      provider: 'local-speech',
      gender: 'female',
      languages: [{ code: 'zh-CN', title: 'Chinese (Mandarin)' }],
    }],
  },
})
