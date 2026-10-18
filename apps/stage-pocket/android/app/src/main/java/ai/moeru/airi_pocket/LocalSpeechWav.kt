package ai.moeru.airi_pocket

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Encodes mono samples in the range [-1, 1] as a 16-bit PCM WAV file.
 * The WebView plays the result with the same audio path as other speech providers.
 */
internal fun encodeWav(samples: FloatArray, sampleRate: Int): ByteArray {
    val dataSize = samples.size * 2
    val buffer = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("RIFF".toByteArray(Charsets.US_ASCII))
    buffer.putInt(36 + dataSize)
    buffer.put("WAVE".toByteArray(Charsets.US_ASCII))
    buffer.put("fmt ".toByteArray(Charsets.US_ASCII))
    buffer.putInt(16)
    buffer.putShort(1) // PCM
    buffer.putShort(1) // mono
    buffer.putInt(sampleRate)
    buffer.putInt(sampleRate * 2) // byte rate
    buffer.putShort(2) // block align
    buffer.putShort(16) // bits per sample
    buffer.put("data".toByteArray(Charsets.US_ASCII))
    buffer.putInt(dataSize)
    for (sample in samples) {
        buffer.putShort((sample.coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort())
    }
    return buffer.array()
}
