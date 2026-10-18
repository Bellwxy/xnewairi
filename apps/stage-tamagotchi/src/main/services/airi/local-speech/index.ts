import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { LocalSpeechAvailability, LocalSpeechRequest } from '@proj-airi/stage-shared/local-speech'
import type { OfflineTts } from 'sherpa-onnx-node'

import process from 'node:process'

import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { toWav } from '@proj-airi/audio/encoding'
import { localSpeechAvailability, localSpeechSynthesize } from '@proj-airi/stage-shared/local-speech'
import { desktopLocalSpeechModel } from '@proj-airi/stage-shared/local-speech-model'
import { app } from 'electron'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

/**
 * The build downloads the model into `local-tts` in the app directory.
 * electron-builder `extraResources` copies that directory next to `app.asar`, because native code cannot read files inside the archive.
 */
function modelDirectory() {
  return app.isPackaged
    ? join(process.resourcesPath, 'local-tts', desktopLocalSpeechModel.directory)
    : join(app.getAppPath(), 'local-tts', desktopLocalSpeechModel.directory)
}

/**
 * Owns the offline voice for every window.
 *
 * State:
 * - `tts` loads on the first request and stays loaded until the app quits.
 * - `queue` runs one synthesis at a time, because one native model instance serves all windows.
 * - `stopped` rejects new requests after quit starts. In-flight synthesis finishes.
 */
class LocalSpeech {
  private tts: Promise<OfflineTts> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false

  async availability(): Promise<LocalSpeechAvailability> {
    const directory = modelDirectory()
    try {
      await access(join(directory, desktopLocalSpeechModel.model))
      return { available: true }
    }
    catch {
      return { available: false, reason: `The built-in voice is missing from ${directory}.` }
    }
  }

  synthesize(request: LocalSpeechRequest): Promise<Uint8Array<ArrayBuffer>> {
    if (this.stopped)
      return Promise.reject(new Error('The built-in voice has stopped.'))

    const result = this.queue.then(() => this.generate(request))
    // A failed request must not block the requests after it.
    this.queue = result.catch(() => {})
    return result
  }

  stop() {
    this.stopped = true
  }

  private async generate(request: LocalSpeechRequest) {
    const tts = await this.load()
    const { GenerationConfig } = await import('sherpa-onnx-node')
    const audio = await tts.generateAsync({
      text: request.text,
      enableExternalBuffer: false,
      generationConfig: new GenerationConfig({ sid: 0, speed: request.speed ?? 1 }),
    })
    // `toWav` reads the whole buffer. The copy drops any offset that the native view has.
    return new Uint8Array(toWav(audio.samples.slice().buffer, audio.sampleRate))
  }

  private load() {
    this.tts ??= (async () => {
      const directory = modelDirectory()
      const { OfflineTts } = await import('sherpa-onnx-node')
      return await OfflineTts.createAsync({
        model: {
          vits: {
            model: join(directory, desktopLocalSpeechModel.model),
            lexicon: join(directory, desktopLocalSpeechModel.lexicon),
            tokens: join(directory, desktopLocalSpeechModel.tokens),
          },
          // On Apple M5, 4 threads generate 8 seconds of speech in 1.5 seconds, and 2 threads take 2.4 seconds.
          numThreads: 4,
          provider: 'cpu',
        },
        ruleFsts: desktopLocalSpeechModel.ruleFsts.map(file => join(directory, file)).join(','),
        maxNumSentences: 1,
      })
    })()
    // A failed load is not cached, so a later request can try again after the files are fixed.
    this.tts.catch(() => {
      this.tts = undefined
    })
    return this.tts
  }
}

/**
 * Registers the offline voice handlers for every renderer window.
 *
 * Call stack:
 *
 * setupLocalSpeech
 *   -> {@link LocalSpeech.synthesize}
 *     -> OfflineTts.generateAsync (sherpa-onnx-node)
 *       -> {@link toWav}
 */
export function setupLocalSpeech(context: ReturnType<typeof createContext>['context']) {
  const localSpeech = new LocalSpeech()
  defineInvokeHandler(context, localSpeechAvailability, () => localSpeech.availability())
  defineInvokeHandler(context, localSpeechSynthesize, async (request) => {
    try {
      return await localSpeech.synthesize(request)
    }
    catch (error) {
      throw new Error(`Built-in voice failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
    }
  })
  onAppBeforeQuit(() => localSpeech.stop())
}
