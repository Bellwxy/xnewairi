package ai.moeru.airi_pocket

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalSpeechWavTest {
    @Test
    fun `encodes mono samples as 16-bit PCM WAV`() {
        val wav = encodeWav(floatArrayOf(0f, 1f, -1f, 2f), 22050)
        val buffer = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)

        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals("WAVE", String(wav, 8, 4, Charsets.US_ASCII))
        assertEquals(22050, buffer.getInt(24))
        assertEquals(8, buffer.getInt(40))
        assertEquals(52, wav.size)
        assertEquals(0.toShort(), buffer.getShort(44))
        assertEquals(Short.MAX_VALUE, buffer.getShort(46))
        assertEquals((-Short.MAX_VALUE).toShort(), buffer.getShort(48))
        // A sample outside [-1, 1] is clamped, not wrapped.
        assertEquals(Short.MAX_VALUE, buffer.getShort(50))
    }
}
