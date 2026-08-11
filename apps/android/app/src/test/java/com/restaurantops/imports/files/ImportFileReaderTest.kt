package com.restaurantops.imports.files

import com.restaurantops.imports.network.ImportRequestException
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportFileReaderTest {
    @Test
    fun `provider boundary maps direct query runtime failure`() {
        val cause = IllegalStateException("query failed")

        val error = captureImportErrorBlocking {
            ImportProviderBoundary.metadata { throw cause }
        }

        assertEquals(422, error.statusCode)
        assertEquals("无法读取所选文件", error.message)
        assertTrue(error.cause === cause)
    }

    @Test
    fun `provider boundary closes cursor-like resource when lazy access fails`() {
        val resource = TrackingCloseable()
        val cause = IllegalArgumentException("lazy column failed")

        val error = captureImportErrorBlocking {
            ImportProviderBoundary.metadata {
                resource.use { throw cause }
            }
        }

        assertEquals("无法读取所选文件", error.message)
        assertTrue(error.cause === cause)
        assertTrue(resource.closed)
    }

    @Test
    fun `provider boundary maps open runtime failure`() = runBlocking {
        val cause = IllegalStateException("open failed")

        val error = captureImportError {
            ImportProviderBoundary.content {
                readImportFileBytes(1) { throw cause }
            }
        }

        assertTrue(error.cause === cause)
    }

    @Test
    fun `provider boundary maps IO read failure and closes stream`() = runBlocking {
        val cause = IOException("read failed")
        val stream = FailingInputStream(cause)

        val error = captureImportError {
            ImportProviderBoundary.content {
                readImportFileBytes(1) { stream }
            }
        }

        assertTrue(error.cause === cause)
        assertTrue(stream.closed)
    }

    @Test
    fun `provider boundary maps runtime read failure and closes stream`() = runBlocking {
        val cause = IllegalStateException("provider read failed")
        val stream = FailingInputStream(cause)

        val error = captureImportError {
            ImportProviderBoundary.content {
                readImportFileBytes(1) { stream }
            }
        }

        assertTrue(error.cause === cause)
        assertTrue(stream.closed)
    }

    @Test
    fun `provider boundary preserves cancellation and existing typed errors`() = runBlocking {
        val cancellation = CancellationException("cancelled")
        val typed = ImportRequestException(422, "typed")
        val fatal = AssertionError("fatal")

        val cancellationResult = runCatching {
            ImportProviderBoundary.content<Unit> { throw cancellation }
        }.exceptionOrNull()
        val typedResult = runCatching {
            ImportProviderBoundary.content<Unit> { throw typed }
        }.exceptionOrNull()
        val fatalResult = runCatching {
            ImportProviderBoundary.content<Unit> { throw fatal }
        }.exceptionOrNull()

        assertTrue(cancellationResult === cancellation)
        assertTrue(typedResult === typed)
        assertTrue(fatalResult === fatal)
    }

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

    @Test
    fun `bounded reader recovers after zero progress`() = runBlocking {
        val stream = ZeroThenDataInputStream(byteArrayOf(1, 2, 3))

        val result = readImportFileBytes(3) { stream }

        assertArrayEquals(byteArrayOf(1, 2, 3), result)
        assertTrue(stream.closed)
    }

    @Test
    fun `bounded reader rejects repeated zero progress in finite reads and closes stream`() = runBlocking {
        val stream = AlwaysZeroInputStream()

        val error = captureImportError { readImportFileBytes(1) { stream } }

        assertEquals(422, error.statusCode)
        assertEquals("无法读取所选文件", error.message)
        assertEquals(4, stream.readCalls)
        assertTrue(stream.closed)
    }

    private suspend fun captureImportError(block: suspend () -> Unit): ImportRequestException = try {
        block()
        error("Expected ImportRequestException")
    } catch (expected: ImportRequestException) {
        expected
    }

    private fun captureImportErrorBlocking(block: () -> Unit): ImportRequestException = try {
        block()
        error("Expected ImportRequestException")
    } catch (expected: ImportRequestException) {
        expected
    }

    private class TrackingCloseable : Closeable {
        var closed = false

        override fun close() {
            closed = true
        }
    }

    private class FailingInputStream(private val failure: Throwable) : InputStream() {
        var closed = false

        override fun read(): Int = throw failure

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = throw failure

        override fun close() {
            closed = true
        }
    }

    private class ZeroThenDataInputStream(bytes: ByteArray) : InputStream() {
        private val delegate = ByteArrayInputStream(bytes)
        private var returnedZero = false
        var closed = false

        override fun read(): Int = delegate.read()

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (!returnedZero) {
                returnedZero = true
                return 0
            }
            return delegate.read(buffer, offset, length)
        }

        override fun close() {
            closed = true
            delegate.close()
        }
    }

    private class AlwaysZeroInputStream : InputStream() {
        var readCalls = 0
        var closed = false

        override fun read(): Int = 0

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            readCalls += 1
            return 0
        }

        override fun close() {
            closed = true
        }
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
