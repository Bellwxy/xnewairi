import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContext, defineInvoke } from '@moeru/eventa'
import { localSpeechAvailability, localSpeechSynthesize } from '@proj-airi/stage-shared/local-speech'
import { desktopLocalSpeechModel } from '@proj-airi/stage-shared/local-speech-model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { setupLocalSpeech } from './index'

const appMock = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(),
}))

const sherpa = vi.hoisted(() => ({
  createAsync: vi.fn(),
  generateAsync: vi.fn(),
  generationOptions: [] as unknown[],
}))

vi.mock('electron', () => ({ app: appMock }))

vi.mock('sherpa-onnx-node', () => ({
  OfflineTts: { createAsync: sherpa.createAsync },
  GenerationConfig: class {
    constructor(options: unknown) {
      sherpa.generationOptions.push(options)
    }
  },
}))

let appPath: string

beforeEach(async () => {
  vi.clearAllMocks()
  sherpa.generationOptions.length = 0
  appPath = await mkdtemp(join(tmpdir(), 'airi-local-speech-'))
  appMock.getAppPath.mockReturnValue(appPath)
  sherpa.generateAsync.mockResolvedValue({ samples: new Float32Array([0, 0.5, -0.5]), sampleRate: 44100 })
  sherpa.createAsync.mockResolvedValue({ generateAsync: sherpa.generateAsync })
})

afterEach(async () => {
  await rm(appPath, { recursive: true, force: true })
})

async function installModel() {
  const directory = join(appPath, 'local-tts', desktopLocalSpeechModel.directory)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, desktopLocalSpeechModel.model), '')
  return directory
}

function setup() {
  const context = createContext()
  setupLocalSpeech(context as never)
  return {
    availability: defineInvoke(context, localSpeechAvailability),
    synthesize: defineInvoke(context, localSpeechSynthesize),
  }
}

describe('setupLocalSpeech', () => {
  it('reports a missing model as unavailable', async () => {
    const { availability } = setup()

    await expect(availability()).resolves.toMatchObject({ available: false })
  })

  it('loads the model from the app directory and returns WAV bytes', async () => {
    const directory = await installModel()
    const { availability, synthesize } = setup()

    await expect(availability()).resolves.toEqual({ available: true })
    const wav = await synthesize({ text: '你好', speed: 1.2 })

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new DataView(wav.buffer, wav.byteOffset).getUint32(24, true)).toBe(44100)
    expect(sherpa.createAsync).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({
        vits: expect.objectContaining({ model: join(directory, desktopLocalSpeechModel.model) }),
      }),
    }))
    expect(sherpa.generationOptions).toEqual([{ sid: 0, speed: 1.2 }])
  })

  it('tries the model load again after a failure', async () => {
    await installModel()
    sherpa.createAsync.mockRejectedValueOnce(new Error('broken model'))
    const { synthesize } = setup()

    await expect(synthesize({ text: '你好' })).rejects.toThrow('broken model')
    await expect(synthesize({ text: '你好' })).resolves.toBeInstanceOf(Uint8Array)
    expect(sherpa.createAsync).toHaveBeenCalledTimes(2)
  })

  it('rejects new requests after quit starts', async () => {
    await installModel()
    const { synthesize } = setup()

    await emitAppBeforeQuit()

    await expect(synthesize({ text: '你好' })).rejects.toThrow('stopped')
    expect(sherpa.createAsync).not.toHaveBeenCalled()
  })
})
