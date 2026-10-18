package ai.moeru.airi_pocket

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Runs the offline voice that the APK contains.
 *
 * The Vite build extracts the model into `assets/local-tts`. Keep these names equal to
 * `androidLocalSpeechModel` in `@proj-airi/stage-shared/local-speech-model`.
 *
 * State:
 * - `tts` loads on the first request and stays loaded until the plugin is destroyed.
 * - `executor` runs one synthesis at a time, because one native model instance serves the WebView.
 */
@CapacitorPlugin(name = "LocalSpeech")
class LocalSpeechPlugin : Plugin() {
    private val modelDirectory = "local-tts/vits-piper-zh_CN-xiao_ya-medium-int8"
    private val modelFile = "zh_CN-xiao_ya-medium.onnx"
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var tts: OfflineTts? = null

    /** Reports whether the APK contains the model. It does not load the model. */
    @PluginMethod
    fun availability(call: PluginCall) {
        val available = try {
            context.assets.open("$modelDirectory/$modelFile").close()
            true
        } catch (_: IOException) {
            false
        }
        call.resolve(JSObject().apply {
            put("available", available)
            if (!available) {
                put("reason", "The built-in voice is missing from the app package.")
            }
        })
    }

    /** Resolves with `wav`, the base64 WAV bytes of mono 16-bit PCM. */
    @PluginMethod
    fun synthesize(call: PluginCall) {
        val text = call.getString("text")
        if (text == null) {
            call.reject("text is required")
            return
        }
        val speed = call.getFloat("speed") ?: 1.0f
        executor.execute {
            try {
                val audio = loadTts().generate(text = text, sid = 0, speed = speed)
                val wav = encodeWav(audio.samples, audio.sampleRate)
                call.resolve(JSObject().apply {
                    put("wav", Base64.encodeToString(wav, Base64.NO_WRAP))
                })
            } catch (error: Throwable) {
                // Native load failures are errors, not exceptions. The WebView still needs a rejection.
                call.reject("Built-in voice failed: ${error.message}")
            }
        }
    }

    override fun handleOnDestroy() {
        // The release runs after queued synthesis, so no request uses a freed model.
        executor.execute {
            tts?.release()
            tts = null
        }
        executor.shutdown()
        super.handleOnDestroy()
    }

    private fun loadTts(): OfflineTts {
        tts?.let { return it }
        // With an AssetManager, sherpa-onnx reads every path, including the rule FSTs, from the APK assets.
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                vits = OfflineTtsVitsModelConfig(
                    model = "$modelDirectory/$modelFile",
                    lexicon = "$modelDirectory/lexicon.txt",
                    tokens = "$modelDirectory/tokens.txt",
                ),
                numThreads = 2,
                provider = "cpu",
            ),
            ruleFsts = listOf("date.fst", "phone.fst", "number.fst").joinToString(",") { "$modelDirectory/$it" },
            maxNumSentences = 1,
        )
        return OfflineTts(assetManager = context.assets, config = config).also { tts = it }
    }
}
