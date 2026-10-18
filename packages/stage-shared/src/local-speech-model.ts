/**
 * The offline voice that the desktop package contains.
 * The desktop build downloads these files, and the Electron main process reads them by the same names.
 */
export const desktopLocalSpeechModel = {
  repository: 'csukuangfj/vits-melo-tts-zh_en',
  revision: 'a0d5c6a264c0ef92d70d8661d8cc502d79627cd6',
  directory: 'vits-melo-tts-zh_en',
  // The fp32 model is 170 MB. The 54 MB `model.int8.onnx` is 3 to 5 times slower on Apple Silicon, and cannot keep up with playback.
  model: 'model.onnx',
  lexicon: 'lexicon.txt',
  tokens: 'tokens.txt',
  // Text normalization rules. They read dates, phone numbers, digits, and words with several pronunciations.
  ruleFsts: ['date.fst', 'phone.fst', 'number.fst', 'new_heteronym.fst'],
} as const

/**
 * The offline voice that the Android package contains.
 * Phones are several times slower than desktops, so Android uses a Piper voice that synthesizes about 7 times faster than the desktop voice.
 * `LocalSpeechPlugin.kt` repeats the directory and file names, so change both together.
 */
export const androidLocalSpeechModel = {
  // sherpa-onnx publishes this voice only as an archive. Release assets can be replaced, so the build checks the digest.
  archive: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-zh_CN-xiao_ya-medium-int8.tar.bz2',
    sha256: 'eab027e194e70289233cf12308373611fa4e2e96ef2d97354ef433ab663d831f',
  },
  directory: 'vits-piper-zh_CN-xiao_ya-medium-int8',
  model: 'zh_CN-xiao_ya-medium.onnx',
} as const

/** The native sherpa-onnx library for Android. The app module compiles against it from `android/app/libs`. */
export const androidSherpaOnnxLibrary = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-1.13.8.aar',
  sha256: '633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96',
  filename: 'sherpa-onnx-1.13.8.aar',
} as const

/**
 * Lists the desktop voice files to download into `<parent>/<directory>`.
 * `endpoint` is a Hugging Face compatible host, so a build machine can use a mirror.
 *
 * @example
 * desktopLocalSpeechModelDownloads('https://hf-mirror.com')[0]
 * // => { url: 'https://hf-mirror.com/csukuangfj/vits-melo-tts-zh_en/resolve/a0d5…/model.onnx', filename: 'model.onnx', destination: 'vits-melo-tts-zh_en' }
 */
export function desktopLocalSpeechModelDownloads(endpoint: string) {
  const model = desktopLocalSpeechModel
  const base = `${endpoint.replace(/\/+$/, '')}/${model.repository}/resolve/${model.revision}`
  const files = [model.model, model.lexicon, model.tokens, ...model.ruleFsts, 'LICENSE']
  return files.map(filename => ({
    url: `${base}/${filename}`,
    filename,
    destination: model.directory,
  }))
}
