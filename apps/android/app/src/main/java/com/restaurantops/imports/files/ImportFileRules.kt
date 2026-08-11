package com.restaurantops.imports.files

import com.restaurantops.imports.ImportSourceType
import java.util.Locale

object ImportFileRules {
    const val MAX_BYTES = 5L * 1024 * 1024

    private val csvMimeTypes = arrayOf(
        "text/csv",
        "text/comma-separated-values",
        "application/csv",
        "application/vnd.ms-excel"
    )
    private val xlsxMimeTypes = arrayOf(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    fun pickerMimeTypes(sourceType: ImportSourceType): Array<String> = when (sourceType) {
        ImportSourceType.CSV -> csvMimeTypes.copyOf()
        ImportSourceType.XLSX -> xlsxMimeTypes.copyOf()
        ImportSourceType.MANUAL -> emptyArray()
    }

    fun validate(name: String?, size: Long?, sourceType: ImportSourceType): String? {
        if (sourceType == ImportSourceType.MANUAL) return "手工录入不接受文件"
        val normalizedName = name?.trim()?.takeIf { it.isNotEmpty() } ?: return "无法读取文件名"
        val expectedExtension = when (sourceType) {
            ImportSourceType.CSV -> ".csv"
            ImportSourceType.XLSX -> ".xlsx"
            ImportSourceType.MANUAL -> error("Handled above")
        }
        if (!normalizedName.lowercase(Locale.ROOT).endsWith(expectedExtension)) {
            return if (sourceType == ImportSourceType.CSV) "请选择 CSV 文件" else "请选择 Excel 文件"
        }
        if (size == null || size < 1) return "无法读取文件大小"
        if (size > MAX_BYTES) return "文件不能超过 5 MiB"
        return null
    }

    @Suppress("UNUSED_PARAMETER")
    fun normalizedMimeType(
        displayName: String,
        sourceType: ImportSourceType,
        providerMimeType: String?
    ): String = when (sourceType) {
        ImportSourceType.CSV -> "text/csv"
        ImportSourceType.XLSX -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ImportSourceType.MANUAL -> "application/octet-stream"
    }
}
