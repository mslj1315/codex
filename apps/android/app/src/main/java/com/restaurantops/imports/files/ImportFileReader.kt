package com.restaurantops.imports.files

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import com.restaurantops.imports.ImportSourceType
import com.restaurantops.imports.PreparedImportFile
import com.restaurantops.imports.network.ImportRequestException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield

internal object ImportProviderBoundary {
    fun <T> metadata(block: () -> T): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: ImportRequestException) {
        throw error
    } catch (error: IOException) {
        throw ImportRequestException(422, "无法读取所选文件", error)
    } catch (error: RuntimeException) {
        throw ImportRequestException(422, "无法读取所选文件", error)
    }

    suspend fun <T> content(block: suspend () -> T): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: ImportRequestException) {
        throw error
    } catch (error: IOException) {
        throw ImportRequestException(422, "无法读取所选文件", error)
    } catch (error: RuntimeException) {
        throw ImportRequestException(422, "无法读取所选文件", error)
    }
}

interface ImportFileReader {
    suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile
}

class AndroidImportFileReader(
    private val contentResolver: ContentResolver,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) : ImportFileReader {
    override suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile =
        withContext(ioDispatcher) {
            val contentUri = try {
                Uri.parse(uri)
            } catch (error: RuntimeException) {
                throw ImportRequestException(422, "请选择系统文件", error)
            }.takeIf { it.scheme == ContentResolver.SCHEME_CONTENT }
                ?: throw ImportRequestException(422, "请选择系统文件")
            val metadata = readMetadata(contentUri)
            ImportFileRules.validate(metadata.displayName, metadata.sizeBytes, sourceType)?.let { message ->
                throw ImportRequestException(422, message)
            }
            val bytes = ImportProviderBoundary.content {
                readImportFileBytes(metadata.sizeBytes) { contentResolver.openInputStream(contentUri) }
            }
            PreparedImportFile(
                uri = contentUri.toString(),
                displayName = metadata.displayName,
                mimeType = ImportFileRules.normalizedMimeType(
                    metadata.displayName,
                    sourceType,
                    providerMimeType(contentUri)
                ),
                sizeBytes = bytes.size.toLong(),
                bytes = bytes
            )
        }

    private fun providerMimeType(uri: Uri): String? = ImportProviderBoundary.metadata {
        contentResolver.getType(uri)
    }

    private fun readMetadata(uri: Uri): FileMetadata = ImportProviderBoundary.metadata {
        val cursor = contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
            null,
            null,
            null
        ) ?: throw ImportRequestException(422, "无法读取所选文件")

        cursor.use {
            if (!it.moveToFirst()) throw ImportRequestException(422, "无法读取所选文件")
            val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = it.getColumnIndex(OpenableColumns.SIZE)
            val displayName = if (nameIndex >= 0 && !it.isNull(nameIndex)) it.getString(nameIndex) else null
            val sizeBytes = if (sizeIndex >= 0 && !it.isNull(sizeIndex)) it.getLong(sizeIndex) else null
            FileMetadata(
                displayName = displayName?.trim()?.takeIf { name -> name.isNotEmpty() }
                    ?: throw ImportRequestException(422, "无法读取文件名"),
                sizeBytes = sizeBytes ?: throw ImportRequestException(422, "无法读取文件大小")
            )
        }
    }

    private data class FileMetadata(val displayName: String, val sizeBytes: Long)
}

internal suspend fun readImportFileBytes(
    metadataSize: Long?,
    openStream: () -> InputStream?
): ByteArray {
    if (metadataSize == null || metadataSize < 1) throw ImportRequestException(422, "无法读取文件大小")
    if (metadataSize > ImportFileRules.MAX_BYTES) throw ImportRequestException(422, "文件不能超过 5 MiB")
    val stream = openStream() ?: throw ImportRequestException(422, "无法读取所选文件")
    return stream.use { input ->
        val output = ByteArrayOutputStream(metadataSize.toInt())
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var consecutiveZeroReads = 0
        while (true) {
            currentCoroutineContext().ensureActive()
            val bytesUntilOverflow = ImportFileRules.MAX_BYTES - output.size() + 1
            val readLength = minOf(buffer.size.toLong(), bytesUntilOverflow).toInt()
            val count = input.read(buffer, 0, readLength)
            if (count < 0) break
            if (count == 0) {
                consecutiveZeroReads += 1
                if (consecutiveZeroReads > MAX_CONSECUTIVE_ZERO_READ_RETRIES) {
                    throw ImportRequestException(422, "无法读取所选文件")
                }
                yield()
                continue
            }
            consecutiveZeroReads = 0
            if (output.size().toLong() + count > ImportFileRules.MAX_BYTES) {
                throw ImportRequestException(422, "文件不能超过 5 MiB")
            }
            output.write(buffer, 0, count)
        }
        output.toByteArray().takeIf { it.isNotEmpty() }
            ?: throw ImportRequestException(422, "无法读取文件大小")
    }
}

private const val MAX_CONSECUTIVE_ZERO_READ_RETRIES = 3
