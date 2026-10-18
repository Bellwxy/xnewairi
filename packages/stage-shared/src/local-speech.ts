import { defineInvokeEventa } from '@moeru/eventa'

/**
 * One request for the offline voice that the application package contains.
 * The Electron main process and the Android plugin both run sherpa-onnx, each with the model that `local-speech-model` names.
 */
export interface LocalSpeechRequest {
  text: string
  /**
   * Speaking speed. Values above 1 speak faster.
   *
   * @default 1
   */
  speed?: number
}

/** Tells if the package contains the voice, and why it cannot run when it is missing. */
export interface LocalSpeechAvailability {
  available: boolean
  reason?: string
}

/** Resolves with WAV bytes of mono 16-bit PCM. The main process rejects when synthesis fails. */
export const localSpeechSynthesize = defineInvokeEventa<Uint8Array<ArrayBuffer>, LocalSpeechRequest>('eventa:invoke:electron:local-speech:synthesize')

export const localSpeechAvailability = defineInvokeEventa<LocalSpeechAvailability>('eventa:invoke:electron:local-speech:availability')
