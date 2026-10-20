<h1 align="center">アイリ VTuber</h1>

<p align="center">
  [<a href="https://airi.ayaka.io">Try it</a>]
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama)

## Local Hearing

Stage Pocket bundles the Paraformer recognizer in the application package. Recognition works offline on first start.
The build bundles it when `SHERPAW_BUNDLE_MODELS=true`. The Android release workflow sets it. A build without it has no recognizer.
Hearing settings list only the bundled model. The app does not download recognizers at runtime.

## Built-in Voice

On Android, `LocalSpeechPlugin` runs an offline Chinese Piper voice with sherpa-onnx. The `local-speech` provider calls it through `src/modules/local-speech.ts`.
The Vite config downloads the sherpa-onnx AAR into `android/app/libs` and extracts the voice into `android/app/src/main/assets/local-tts`. It checks the SHA-256 digest of both files.
Run a Vite build before Gradle. Without the AAR, the app module does not compile.
The `tar` command must read bzip2 archives. iOS has no plugin yet, so the voice is not available there.

## Supported Devices

The Android build includes native libraries for `arm64-v8a` only. It does not install on 32-bit ARM or x86 devices.
Each other ABI adds 24 to 41 MB. To add one, edit `abiFilters` in `android/app/build.gradle.kts`.

## Minimum WebView

The app needs Android System WebView 111 or later, because Vite 8 builds for Chrome 111.
On an older WebView, Capacitor opens `webview-outdated.html`, which tells the user to update the WebView.
When the Vite build target changes, change `android.minWebViewVersion` in `capacitor.config.ts` to match.
Huawei WebView uses its own version numbers. The app keeps the Capacitor default for it, so this check does not cover Huawei devices.

## WebSocket Bridge

Stage Pocket adds a host-backed WebSocket bridge for `@proj-airi/server-sdk`.

Design constraints:
- keep page loading on secure origins (`https` or app-hosted local origins) to preserve secure-context web APIs
- only implement the WebSocket bridge needed by `@proj-airi/server-sdk`
- native owns socket I/O; `server-sdk` owns reconnect, heartbeat, authentication, and connection state
- the bridge only forwards `connect`, `send`, `close`, `open`, `message`, `error`, and `close`
