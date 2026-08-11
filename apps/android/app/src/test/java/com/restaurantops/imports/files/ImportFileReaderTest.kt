package com.restaurantops.imports.files

import com.restaurantops.imports.network.ImportRequestException
import java.io.ByteArrayInputStream
import java.io.InputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportFileReaderTest {
    @Test
    fun `bounded reader accepts exact limit and closes stream`() = runBlocking {
        val bytes = ByteArray(ImportFileRules.MAX_BYTES.toInt()) { (it % 251).toByte() }
        val stream = TrackingInputStream(bytes)

        val result = readImportFileBytes(bytes.size.toLong()) { stream }

        assertArrayEquals(bytes, result)
        assertTrue(stream.closed)
    }

    @Test
    fun `bounded reader stops at first byte over limit and closes stream`() = runBlocking {
        val stream = TrackingInputStream(ByteArray((ImportFileRules.MAX_BYTES + 1).toInt()))

        val error = captureImportError {
            readImportFileBytes(ImportFileRules.MAX_BYTES) { stream }
        }

        assertEquals(422, error.statusCode)
        assertEquals("文件不能超过 5 MiB", error.message)
        assertEquals(ImportFileRules.MAX_BYTES + 1, stream.bytesRead)
        assertTrue(stream.closed)
    }

    @Test
    fun `bounded reader rejects empty actual content and closes stream`() = runBlocking {
        val stream = TrackingInputStream(byteArrayOf())

        val error = captureImportError { readImportFileBytes(1) { stream } }

        assertEquals("无法读取文件大小", error.message)
        assertTrue(stream.closed)
    }

    @Test
    fun `metadata size rejection happens before opening stream`() = runBlocking {
        var opened = false

        val error = captureImportError {
            readImportFileBytes(ImportFileRules.MAX_BYTES + 1) {
                opened = true
                TrackingInputStream(byteArrayOf(1))
            }
        }

        assertEquals("文件不能超过 5 MiB", error.message)
        assertFalse(opened)
    }

    @Test
    fun `missing stream becomes typed error`() = runBlocking {
        val error = captureImportError { readImportFileBytes(1) { null } }

        assertEquals(422, error.statusCode)
        assertEquals("无法读取所选文件", error.message)
    }

    private suspend fun captureImportError(block: suspend () -> Unit): ImportRequestException = try {
        block()
        error("Expected ImportRequestException")
    } catch (expected: ImportRequestException) {
        expected
    }

    private class TrackingInputStream(bytes: ByteArray) : InputStream() {
        private val delegate = ByteArrayInputStream(bytes)
        var closed = false
        var bytesRead = 0L

        override fun read(): Int = delegate.read().also { if (it >= 0) bytesRead += 1 }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            delegate.read(buffer, offset, length).also { if (it > 0) bytesRead += it }

        override fun close() {
            closed = true
            delegate.close()
        }
    }
}
