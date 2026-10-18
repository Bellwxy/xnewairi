// NOTICE:
// sherpa-onnx-node ships JavaScript with JSDoc typedefs and no declaration files.
// This file declares only the offline TTS surface that the local speech service calls.
// Source: node_modules/sherpa-onnx-node/non-streaming-tts.js and types.js (1.13.8).
// Remove when the package publishes its own declarations.
declare module 'sherpa-onnx-node' {
  export interface OfflineTtsConfig {
    model: {
      vits: {
        model: string
        lexicon: string
        tokens: string
        dictDir?: string
      }
      numThreads?: number
      provider?: 'cpu'
      debug?: boolean
    }
    ruleFsts?: string
    maxNumSentences?: number
  }

  export interface GeneratedAudio {
    samples: Float32Array
    sampleRate: number
  }

  export class GenerationConfig {
    constructor(options: { sid?: number, speed?: number, silenceScale?: number })
  }

  export class OfflineTts {
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>
    readonly sampleRate: number
    generateAsync(request: { text: string, enableExternalBuffer?: boolean, generationConfig: GenerationConfig }): Promise<GeneratedAudio>
  }
}
